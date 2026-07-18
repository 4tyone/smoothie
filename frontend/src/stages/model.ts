// model (spec 03) — the domain-modeling stage of the ontology track. The model
// PROPOSES entity types, entities, and typed links from the facts; CODE OWNS the
// contract: it assigns stable content-anchored ids, resolves entities by natural
// key AND glossary equivalence (the segment-rename fix, spec 07 §1), materializes
// provenance, and produces a typed `OntologyDraft`. Resolution is folded in here as
// deterministic natural-key/alias merging for Phase 2 (spec 09 §6.1); it becomes a
// first-class, gated stage in Phase 3 (spec 04).
//
// Two paths, selected by the gateway kind: the deterministic gateway proposes
// mechanically (spec 09 §4), the real gateway via the modeling agent. The
// materialization below is identical for both — the model never writes an id.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ModelResult } from "../ontology/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { StageSettings } from "../config.ts";
import type { BcFact } from "./describe.ts";
import { runModelAgent } from "../agent/model-agent.ts";
import { canonicalizeTypes } from "./canonicalize-types.ts";

export interface GlossarySeed {
  term: string;
  definition: string;
  aliases?: string[];
  type?: string;
}

// ── the typed draft the model stage hands to compile-ontology ──
interface PropSchemaOut {
  value_kind: "string" | "number" | "boolean" | "date" | "geopoint" | "enum" | "ref";
  cardinality: "one" | "many";
  required: boolean;
  identity: boolean;
}
export interface EntityTypeOut {
  type_id: string;
  name: string;
  property_schema: Record<string, PropSchemaOut>;
  provenance: { fact_ids: string[] };
  fidelity: "claimed";
  status: "open" | "closed";
}
export interface PropertyValueOut {
  value: unknown;
  fact_ids: string[];
  fidelity: string;
}
export interface EntityOut {
  entity_id: string;
  type_id: string;
  label: string;
  aliases: Array<{ text: string; source_id: string }>;
  properties: Record<string, PropertyValueOut[]>;
  provenance: { fact_ids: string[]; source_ids: string[] };
  status: "active";
  /** Set by the resolve stage (spec 04): the members a canonical absorbed. */
  resolved_from?: string[];
  /** Set by the resolve stage on a member: the canonical it merged into. */
  merged_into?: string;
}
interface LinkTypeOut {
  link_type_id: string;
  name: string;
  from_type_id: string;
  to_type_id: string;
  cardinality: "many_to_many";
  directed: boolean;
  provenance: { fact_ids: string[] };
  status: "open";
}
interface LinkOut {
  link_id: string;
  link_type_id: string;
  from: string;
  to: string;
  properties?: Record<string, unknown>;
  provenance: { fact_ids: string[] };
  fidelity: string;
}
export interface OntologyDraft {
  entity_types: Record<string, EntityTypeOut>;
  entities: Record<string, EntityOut>;
  link_types: Record<string, LinkTypeOut>;
  links: Record<string, LinkOut>;
  resolutions: Record<string, unknown>;
}

// ── helpers (all deterministic) ──
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
const sha12 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const normKey = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim();
const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

interface Group {
  canonical: string;
  type?: string;
  forms: string[];
}

export interface ModelInput {
  facts: BcFact[];
  glossarySeeds: GlossarySeed[];
  goals: Array<{ id: string; text: string }>;
}

/** Run the model stage: get proposals from the gateway, then materialize (code).
 *  `cacheDir` (real path only) makes the stage RESUMABLE: each batch's proposals are
 *  written to disk as it completes, keyed by content hash, so a crash mid-stage
 *  resumes from the last finished batch instead of re-calling the model for all of
 *  them (crash resilience, parity with the bc pipeline's per-source describe cache). */
export async function runModel(input: ModelInput, gateway: ModelGateway, stage: StageSettings = {}, cacheDir?: string): Promise<OntologyDraft> {
  const factCtx = input.facts.map((f) => ({
    fact_id: f.fact_id,
    text: f.text,
    source_id: f.source_refs[0]?.source_id ?? "",
  }));

  let proposals;
  if (gateway.kind === "stub") {
    proposals = await gateway.extract({
      label: "model",
      instruction: "",
      content: JSON.stringify({ facts: factCtx, glossary: input.glossarySeeds, goals: input.goals }),
      schema: ModelResult,
    });
  } else {
    // The real model call is bounded by batching facts by source (a single call over a
    // large corpus overflows context). Proposals are concatenated and materialized once
    // — code-owned ids merge same-key entities across batches (spec 05 §2).
    proposals = await runModelBatched(input, gateway, stage, cacheDir);
  }

  // Consolidate the type/relation vocabulary before ids are assigned (spec 03): the
  // model coins a sprawling, near-duplicate vocabulary; this folds it onto a canonical
  // set so equivalent types/relations share one id. Domain-agnostic + cached.
  const entCounts = new Map<string, number>();
  for (const p of proposals.entities ?? []) {
    const t = p.type || "Topic";
    entCounts.set(t, (entCounts.get(t) ?? 0) + 1);
  }
  const linkCounts = new Map<string, number>();
  for (const p of proposals.links ?? []) {
    const t = p.link_type || "related_to";
    linkCounts.set(t, (linkCounts.get(t) ?? 0) + 1);
  }
  const maps = await canonicalizeTypes(entCounts, linkCounts, gateway, stage, cacheDir);
  for (const p of proposals.entities ?? []) p.type = maps.entityTypes.get(p.type || "Topic") ?? p.type;
  for (const p of proposals.links ?? []) p.link_type = maps.linkTypes.get(p.link_type || "related_to") ?? p.link_type;

  return materialize(proposals, input.glossarySeeds, input.facts);
}

/** Facts per real-model `model` call. Keeps each batch well within context; sources
 *  are never split across batches, so an entity's facts stay together. */
const MAX_FACTS_PER_BATCH = 400;

type ModelProposals = import("valibot").InferOutput<typeof ModelResult>;

/** Content-anchored cache key for one batch: same facts + glossary + model ⇒ same key,
 *  so a resumed run reuses the exact proposals a completed batch produced (spec 05 §2). */
function batchKey(batch: BcFact[], glossarySeeds: GlossarySeed[], stage: StageSettings): string {
  const canonical = JSON.stringify({
    facts: batch.map((f) => [f.fact_id, f.text]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    glossary: glossarySeeds.map((g) => [g.term, g.type ?? "", ...(g.aliases ?? [])]).sort(),
    model: stage.model ?? "",
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

async function runModelBatched(input: ModelInput, gateway: ModelGateway, stage: StageSettings, cacheDir?: string): Promise<ModelProposals> {
  const bySource = new Map<string, BcFact[]>();
  for (const f of input.facts) {
    const sid = f.source_refs[0]?.source_id ?? "";
    if (!bySource.has(sid)) bySource.set(sid, []);
    bySource.get(sid)!.push(f);
  }
  const batches: BcFact[][] = [];
  let cur: BcFact[] = [];
  for (const facts of bySource.values()) {
    if (cur.length && cur.length + facts.length > MAX_FACTS_PER_BATCH) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...facts);
  }
  if (cur.length) batches.push(cur);

  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });

  const merged: ModelProposals = { entities: [], links: [] };
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const cacheFile = cacheDir ? path.join(cacheDir, `batch-${batchKey(b, input.glossarySeeds, stage)}.json`) : undefined;

    let p: ModelProposals | undefined;
    if (cacheFile && fs.existsSync(cacheFile)) {
      try {
        p = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as ModelProposals;
        process.stderr.write(`model: batch ${i + 1}/${batches.length} (${b.length} facts) — cache hit\n`);
      } catch {
        p = undefined; // corrupt/partial write (e.g. crash mid-write) — recompute
      }
    }
    if (!p) {
      process.stderr.write(`model: batch ${i + 1}/${batches.length} (${b.length} facts) — calling model\n`);
      p = await runModelAgent({ facts: b, glossarySeeds: input.glossarySeeds, goals: input.goals }, gateway, stage);
      // Atomic write (tmp + rename) so a crash can't leave a half-written cache file.
      if (cacheFile) {
        const tmp = cacheFile + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(p));
        fs.renameSync(tmp, cacheFile);
      }
    }
    merged.entities!.push(...(p.entities ?? []));
    merged.links!.push(...(p.links ?? []));
  }
  return merged;
}

/** The code-owned contract materialization — the same for the real and
 *  deterministic gateways. The model never writes an id; every id is derived here
 *  from stable content (spec 05 §2), and equivalent surface forms collapse to one
 *  entity with aliases (spec 01 §5.2, spec 07 §1). */
export function materialize(
  proposals: import("valibot").InferOutput<typeof ModelResult>,
  glossarySeeds: GlossarySeed[],
  facts: BcFact[],
): OntologyDraft {
  const factMap = new Map<string, { text: string; source_id: string }>();
  for (const f of facts) factMap.set(f.fact_id, { text: f.text, source_id: f.source_refs[0]?.source_id ?? "" });

  // Glossary equivalence groups, sorted by canonical for determinism.
  const groups: Group[] = glossarySeeds
    .map((g) => ({ canonical: g.term, type: g.type, forms: uniqSorted([g.term, ...(g.aliases ?? [])]) }))
    .filter((g) => g.forms.length > 0)
    .sort((a, b) => a.canonical.localeCompare(b.canonical));

  interface Acc {
    entity_id: string;
    type_name: string;
    label: string;
    aliases: Map<string, string>; // `${text} ${source_id}` → text (dedupe)
    aliasOrder: Array<{ text: string; source_id: string }>;
    fact_ids: Set<string>;
    source_ids: Set<string>;
  }
  const acc = new Map<string, Acc>();
  // label → entity_id and alias text → entity_id, for link endpoint resolution.
  const labelIndex = new Map<string, string>();

  // Grounding discipline (gate G1/G3): the model may cite a fact id that doesn't exist
  // (a hallucinated ref). Code owns provenance — keep only ids in the fact set; an
  // entity left with no grounded fact is dropped below. `matched` is the glossary
  // equivalence group (authoritative type); `naturalKey` is the id-anchoring key.
  const classify = (p: (typeof proposals.entities)[number]) => {
    const validFactIds = (p.fact_ids ?? []).filter((id) => factMap.has(id));
    const evidence = [
      p.label,
      ...(p.aliases ?? []),
      ...(p.fact_ids ?? []).map((id) => factMap.get(id)?.text ?? ""),
    ].join(" ").toLowerCase();
    const matched = groups.find((g) => g.forms.some((f) => evidence.includes(f.toLowerCase())));
    const naturalKey = matched ? "g:" + matched.canonical : "l:" + normKey(p.label);
    return { validFactIds, evidence, matched, naturalKey };
  };

  // Per-label type reconciliation (spec 03/04): the model types the SAME surface form
  // inconsistently across batches (one label proposed as Segment, Metric, AND Charge),
  // which would split it into phantom entities since the id is derived from (type,
  // label). Decide ONE winning type per natural key — best-grounded (most fact
  // evidence), then most-proposed, then lexicographic — so every occurrence collapses
  // to a single entity. Covers glossary keys too (a glossary term WITHOUT an explicit
  // `type` is reconciled the same way; a glossary `type`, when set, overrides below).
  // Domain-agnostic — the winner is whichever type the corpus grounds best.
  const typeVotes = new Map<string, Map<string, { weight: number; count: number }>>();
  for (const p of proposals.entities) {
    const { matched, naturalKey, validFactIds } = classify(p);
    const tn = matched?.type ?? p.type ?? "Topic";
    const votes = typeVotes.get(naturalKey) ?? new Map<string, { weight: number; count: number }>();
    const v = votes.get(tn) ?? { weight: 0, count: 0 };
    v.weight += validFactIds.length;
    v.count += 1;
    votes.set(tn, v);
    typeVotes.set(naturalKey, votes);
  }
  const winningType = new Map<string, string>();
  for (const [nk, votes] of typeVotes) {
    winningType.set(
      nk,
      [...votes.entries()].sort((a, b) => b[1].weight - a[1].weight || b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))[0][0],
    );
  }

  for (const p of proposals.entities) {
    const { validFactIds, evidence, matched, naturalKey } = classify(p);
    const primarySource = (validFactIds.length && factMap.get(validFactIds[0])?.source_id) || "";

    let typeName: string;
    let label: string;
    const aliasContribs: Array<{ text: string; source_id: string }> = [];
    if (matched) {
      // Glossary `type` is authoritative when set; otherwise reconcile like any label.
      typeName = matched.type ?? winningType.get(naturalKey) ?? p.type ?? "Topic";
      label = matched.canonical;
      for (const form of matched.forms) {
        if (evidence.includes(form.toLowerCase())) aliasContribs.push({ text: form, source_id: primarySource });
      }
    } else {
      typeName = winningType.get(naturalKey) ?? (p.type || "Topic"); // reconciled type
      label = p.label;
      for (const a of p.aliases ?? []) aliasContribs.push({ text: a, source_id: primarySource });
      aliasContribs.push({ text: p.label, source_id: primarySource });
    }

    const typeId = "et_" + slug(typeName);
    const entityId = "e_" + sha12(typeId + "|" + naturalKey);

    let a = acc.get(entityId);
    if (!a) {
      a = { entity_id: entityId, type_name: typeName, label, aliases: new Map(), aliasOrder: [], fact_ids: new Set(), source_ids: new Set() };
      acc.set(entityId, a);
    }
    for (const al of aliasContribs) {
      const key = `${al.text} ${al.source_id}`;
      if (!a.aliases.has(key)) {
        a.aliases.set(key, al.text);
        a.aliasOrder.push(al);
      }
    }
    for (const id of validFactIds) {
      a.fact_ids.add(id);
      const s = factMap.get(id)?.source_id;
      if (s) a.source_ids.add(s);
    }
    if (primarySource) a.source_ids.add(primarySource);

    labelIndex.set(normKey(p.label), entityId);
    labelIndex.set(normKey(label), entityId);
    for (const al of aliasContribs) labelIndex.set(normKey(al.text), entityId);
  }

  // Materialize entities + collect per-type fact provenance.
  const entities: Record<string, EntityOut> = {};
  const typeFacts = new Map<string, Set<string>>(); // type_id → fact_ids
  const typeName = new Map<string, string>();
  const typeOf = new Map<string, string>(); // entity_id → type_id
  for (const a of acc.values()) {
    const factIds = uniqSorted([...a.fact_ids]);
    // An entity whose every cited fact was hallucinated has no grounding — drop it
    // (its type and any links to it fall away with it, below).
    if (factIds.length === 0) continue;
    const typeId = "et_" + slug(a.type_name);
    typeName.set(typeId, a.type_name);
    typeOf.set(a.entity_id, typeId);
    entities[a.entity_id] = {
      entity_id: a.entity_id,
      type_id: typeId,
      label: a.label,
      aliases: a.aliasOrder.slice().sort((x, y) => (x.text + x.source_id).localeCompare(y.text + y.source_id)),
      properties: {
        name: [{ value: a.label, fact_ids: factIds, fidelity: "claimed" }],
      },
      provenance: { fact_ids: factIds, source_ids: uniqSorted([...a.source_ids]) },
      status: "active",
    };
    const tf = typeFacts.get(typeId) ?? new Set<string>();
    for (const f of factIds) tf.add(f);
    typeFacts.set(typeId, tf);
  }

  // Entity types (one per distinct type used).
  const entity_types: Record<string, EntityTypeOut> = {};
  for (const [typeId, name] of typeName) {
    entity_types[typeId] = {
      type_id: typeId,
      name,
      property_schema: {
        name: { value_kind: "string", cardinality: "one", required: true, identity: true },
      },
      provenance: { fact_ids: uniqSorted([...(typeFacts.get(typeId) ?? new Set<string>())]) },
      fidelity: "claimed",
      status: "open",
    };
  }

  // Links (real path only in Phase 2; deterministic proposals carry none). Endpoints
  // resolve by label/alias; a link that cannot ground or resolve is dropped. Fact refs
  // are filtered to the fact set (drop hallucinated ids, as for entities).
  //
  // Two passes so a link type's declared endpoint types (gate G3) reflect ALL its
  // links: a semantic type like `invests_in` legitimately spans heterogeneous
  // endpoints across a large corpus, so its from/to type is the single observed type
  // when homogeneous, else `*` (any). Pinning to the first link's endpoints — the old
  // one-pass behavior — rejected every later link of that type at scale.
  const links: Record<string, LinkOut> = {};
  interface LtObs { name: string; fromTypes: Set<string>; toTypes: Set<string>; facts: Set<string> }
  const ltObserved = new Map<string, LtObs>();
  for (const p of proposals.links ?? []) {
    const fromId = labelIndex.get(normKey(p.from));
    const toId = labelIndex.get(normKey(p.to));
    if (!fromId || !toId || !entities[fromId] || !entities[toId]) continue;
    const factIds = uniqSorted([...(p.fact_ids ?? [])].filter((id) => factMap.has(id)));
    const grounded = factIds.length ? factIds : uniqSorted([...entities[fromId].provenance.fact_ids, ...entities[toId].provenance.fact_ids]);
    if (grounded.length === 0) continue;
    const ltId = "lt_" + slug(p.link_type);
    const linkId = "l_" + sha12(ltId + "|" + fromId + "|" + toId);
    links[linkId] = { link_id: linkId, link_type_id: ltId, from: fromId, to: toId, provenance: { fact_ids: grounded }, fidelity: p.fidelity ?? "guessed" };
    let obs = ltObserved.get(ltId);
    if (!obs) {
      obs = { name: p.link_type, fromTypes: new Set(), toTypes: new Set(), facts: new Set() };
      ltObserved.set(ltId, obs);
    }
    obs.fromTypes.add(typeOf.get(fromId) ?? "*");
    obs.toTypes.add(typeOf.get(toId) ?? "*");
    for (const f of grounded) obs.facts.add(f);
  }

  const link_types: Record<string, LinkTypeOut> = {};
  const endpointType = (s: Set<string>): string => (s.size === 1 && !s.has("*") ? [...s][0] : "*");
  for (const [ltId, obs] of ltObserved) {
    link_types[ltId] = {
      link_type_id: ltId,
      name: obs.name,
      from_type_id: endpointType(obs.fromTypes),
      to_type_id: endpointType(obs.toTypes),
      cardinality: "many_to_many",
      directed: true,
      provenance: { fact_ids: uniqSorted([...obs.facts]) },
      status: "open",
    };
  }

  return { entity_types, entities, link_types, links, resolutions: {} };
}
