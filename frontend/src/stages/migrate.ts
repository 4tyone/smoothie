// migrate (spec 09 §3) — a one-shot `bc.v1` → `ontology.v1` conversion. Facts carry
// over verbatim (the evidence layer is unchanged). Each bc node becomes a candidate
// entity of an inferred type (its node kind seeds the type); its facts become the
// entity's grounding. Each bc edge becomes a candidate typed link. The result is a
// valid but un-refined ontology; a normal incremental build then refines it. Lossless
// for facts/receipts, best-effort for structure.

import * as crypto from "node:crypto";

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
const sha12 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

interface BcNode {
  id: string;
  title: string;
  kind: string;
  fact_ids?: string[];
  source_refs?: Array<{ source_id: string }>;
}
interface BcEdge {
  from: string;
  to: string;
  kind: string;
  fidelity?: string;
  source_refs?: Array<{ source_id: string }>;
}
interface Bc {
  manifest: { bc_id: string; profile: string; authorship?: unknown };
  brief?: { text?: string };
  sources: Record<string, { source_id: string; kind: string; path?: string; hash?: string }>;
  facts: Record<string, { fact_id: string; kind: string; text: string; confidence: number; view_id?: string; fidelity: string; source_refs: unknown[]; brief_id?: string }>;
  graph: { nodes: Record<string, BcNode>; edges: BcEdge[] };
  glossary?: Record<string, { definition: string }>;
}

/** Convert a parsed bc.v1 object into an ontology.v1 object (unsorted; the caller
 *  serializes canonically). Ungrounded nodes (no facts) are skipped best-effort. */
export function migrateBcToOntology(bc: Bc, producerVersion: string): Record<string, unknown> {
  const now = process.env.SMOOTHIE_NOW ?? "2026-01-01T00:00:00Z";

  // Facts carry over verbatim.
  const facts: Record<string, unknown> = {};
  for (const [fid, f] of Object.entries(bc.facts ?? {})) {
    facts[fid] = { fact_id: f.fact_id, kind: f.kind, text: f.text, confidence: f.confidence, ...(f.view_id ? { view_id: f.view_id } : {}), fidelity: f.fidelity, source_refs: f.source_refs, ...(f.brief_id ? { brief_id: f.brief_id } : {}) };
  }

  const firstSource = Object.keys(bc.sources ?? {}).sort()[0] ?? "";
  const nodeToEntity = new Map<string, string>();
  const entities: Record<string, unknown> = {};
  const typeFacts = new Map<string, Set<string>>();
  const typeName = new Map<string, string>();

  for (const [nid, n] of Object.entries(bc.graph?.nodes ?? {})) {
    const factIds = uniqSorted(n.fact_ids ?? []);
    if (factIds.length === 0) continue; // ungrounded node → skip (grounded-by-construction)
    const tname = cap(n.kind || "topic");
    const typeId = "et_" + slug(tname);
    typeName.set(typeId, tname);
    const eid = "e_" + sha12("node|" + nid);
    nodeToEntity.set(nid, eid);
    const sourceIds = uniqSorted((n.source_refs ?? []).map((r) => r.source_id));
    const aliasSource = sourceIds[0] ?? firstSource;
    entities[eid] = {
      entity_id: eid,
      type_id: typeId,
      label: n.title,
      aliases: [{ text: n.title, source_id: aliasSource }],
      properties: { name: [{ value: n.title, fact_ids: factIds, fidelity: "claimed" }] },
      provenance: { fact_ids: factIds, source_ids: sourceIds.length ? sourceIds : [firstSource] },
      status: "active",
    };
    const tf = typeFacts.get(typeId) ?? new Set<string>();
    for (const f of factIds) tf.add(f);
    typeFacts.set(typeId, tf);
  }

  const entity_types: Record<string, unknown> = {};
  const entityTypeOf = new Map<string, string>();
  for (const [eid, e] of Object.entries(entities)) entityTypeOf.set(eid, (e as { type_id: string }).type_id);
  for (const [typeId, name] of typeName) {
    entity_types[typeId] = {
      type_id: typeId,
      name,
      property_schema: { name: { value_kind: "string", cardinality: "one", required: true, identity: true } },
      provenance: { fact_ids: uniqSorted([...(typeFacts.get(typeId) ?? new Set<string>())]) },
      fidelity: "claimed",
      status: "open",
    };
  }

  const links: Record<string, unknown> = {};
  const link_types: Record<string, unknown> = {};
  for (const e of bc.graph?.edges ?? []) {
    const from = nodeToEntity.get(e.from);
    const to = nodeToEntity.get(e.to);
    if (!from || !to) continue; // an endpoint was ungrounded/skipped
    const ltName = e.kind || "related_to";
    const ltId = "lt_" + slug(ltName);
    const factIds = uniqSorted([
      ...((entities[from] as { provenance: { fact_ids: string[] } }).provenance.fact_ids),
      ...((entities[to] as { provenance: { fact_ids: string[] } }).provenance.fact_ids),
    ]);
    const lid = "l_" + sha12(ltId + "|" + from + "|" + to);
    // bc `confirmed` requires a resolution receipt the ontology can't attest here →
    // migrate lands links at claimed/guessed (a later build may promote them).
    const fidelity = e.fidelity === "confirmed" ? "claimed" : e.fidelity === "guessed" ? "guessed" : "claimed";
    links[lid] = { link_id: lid, link_type_id: ltId, from, to, provenance: { fact_ids: factIds }, fidelity };
    if (!link_types[ltId]) {
      // bc edges are untyped and one kind spans many node kinds, so a migrated link
      // type accepts any endpoints (`*`); a later build may specialize it.
      link_types[ltId] = { link_type_id: ltId, name: ltName, from_type_id: "*", to_type_id: "*", cardinality: "many_to_many", directed: true, provenance: { fact_ids: factIds }, status: "open" };
    }
  }

  const sources: Record<string, unknown> = {};
  const sourceHashes: Record<string, string> = {};
  for (const [id, s] of Object.entries(bc.sources ?? {})) {
    sources[id] = { source_id: s.source_id, kind: s.kind, ...(s.path ? { path: s.path } : {}), ...(s.hash ? { hash: s.hash } : {}) };
    sourceHashes[id] = s.hash ?? "";
  }

  const idMaterial = (bc.brief?.text ?? bc.manifest.bc_id) + "|" + Object.values(sourceHashes).sort().join(",");
  const ontologyId = "ont-" + sha12(idMaterial);
  const versionId = "v-" + sha12(ontologyId + "|migrated");

  return {
    schema: "ontology.v1",
    manifest: {
      ontology_id: ontologyId,
      schema: "ontology.v1",
      producer_version: producerVersion,
      profile: bc.manifest.profile,
      created_at: now,
      counts: { entities: Object.keys(entities).length, links: Object.keys(links).length, facts: Object.keys(facts).length, entity_types: Object.keys(entity_types).length, link_types: Object.keys(link_types).length, resolutions: 0 },
    },
    sources,
    facts,
    entity_types,
    entities,
    link_types,
    links,
    resolutions: {},
    glossary: bc.glossary ?? {},
    notes: [],
    policy: {},
    version: { version_id: versionId, created_at: now, envelope: { source_hashes: sourceHashes, model: "migrate", prompt_version: "migrate.v1" }, operations: [{ op: "migrate", from: "bc.v1" }] },
    extensions: {},
  };
}
