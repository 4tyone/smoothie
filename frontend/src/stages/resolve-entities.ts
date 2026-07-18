// resolve (ontology track, spec 04) — entity resolution as a first-class, gated,
// verified, reversible stage. The model JUDGES whether two entities are the same
// real-world thing; CODE DISPOSES: it generates candidates (blocking), computes the
// merge confidence, enforces the gate (merge_confidence + an independent verifier
// below verify_below), clusters accepted pairs, and materializes reversible
// `resolution` records (spec 01 §7). `unresolve` reverses a merge (members are
// retained, never destroyed).
//
// Kept separate from the bc `resolve.ts` until the default flip (spec 09 §2). Two
// paths, selected by the gateway: the deterministic gateway answers same/different by
// surface-form similarity (resolve-sim.ts) so "same input → same ontology" holds; the
// real gateway uses the model.

import * as crypto from "node:crypto";
import { JudgeResult } from "../bc/schemas.ts";
import { similarity } from "./resolve-sim.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { StageSettings } from "../config.ts";
import type { EntityOut, EntityTypeOut } from "./model.ts";

const sha12 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

export interface ResolveConfig {
  merge_confidence: number;
  verify_below: number;
  block_by: string[];
}

export interface ResolutionOut {
  resolution_id: string;
  canonical: string;
  members: string[];
  evidence: { fact_ids: string[]; rationale?: string };
  confidence: number;
  method: "agent" | "agent+verified";
  verified_by?: "judge" | "human";
  reversible: true;
}

export interface ResolveOutput {
  entities: Record<string, EntityOut>;
  resolutions: Record<string, ResolutionOut>;
  merged: number;
}

/** The surface forms of an entity: its canonical label plus every alias. */
const surfaces = (e: EntityOut): string[] => [e.label, ...e.aliases.map((a) => a.text)];

/** Ask the gateway for a same/different judgment (`resolve` = propose, `resolve-verify`
 *  = independent stricter verifier). The model decides; a resolver never guesses
 *  sameness from token overlap alone (spec 04 §2.2). */
async function judge(gateway: ModelGateway, a: EntityOut, b: EntityOut, verify: boolean): Promise<boolean> {
  const res = await gateway.extract({
    label: verify ? "resolve-verify" : "resolve",
    instruction: verify
      ? "Independently verify: are these two records the SAME real-world entity? Answer strictly."
      : "Are these two records the SAME real-world entity? Judge by meaning.",
    content: JSON.stringify({ a: { surfaces: surfaces(a) }, b: { surfaces: surfaces(b) } }),
    schema: JudgeResult,
  });
  return res.yes === true;
}

interface Decision {
  accept: boolean;
  confidence: number;
  method: "agent" | "agent+verified";
}

/** The pairwise resolution decision (spec 04 §2.3): a merge is accepted only when the
 *  model judges same AND the confidence clears `merge_confidence`; a merge whose
 *  confidence is below `verify_below` additionally requires an independent verifier to
 *  confirm. Blocking by type happens before this is called. */
export async function decidePair(
  a: EntityOut,
  b: EntityOut,
  gateway: ModelGateway,
  config: ResolveConfig,
): Promise<Decision> {
  const confidence = similarity(surfaces(a), surfaces(b));
  const reject: Decision = { accept: false, confidence, method: "agent" };

  if (a.type_id !== b.type_id) return reject; // block by type (spec 04 §2.1)
  // Bound the model to genuinely ambiguous candidates on a large corpus: auto-reject
  // below the merge threshold, auto-accept exact matches — neither needs a model call.
  if (confidence < config.merge_confidence) return reject;
  if (confidence >= 1.0) return { accept: true, confidence, method: "agent" };

  // Ambiguous band [merge_confidence, 1.0): the model judges (spec 04 §2.2).
  if (!(await judge(gateway, a, b, false))) return reject;
  if (confidence < config.verify_below) {
    // Mid-band: an independent verifier must confirm before the merge stands.
    if (!(await judge(gateway, a, b, true))) return reject;
    return { accept: true, confidence, method: "agent+verified" };
  }
  return { accept: true, confidence, method: "agent" };
}

// ── union-find over accepted pairs → clusters ──
class DSU {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      const [root, child] = ra < rb ? [ra, rb] : [rb, ra];
      this.parent.set(child, root); // smaller id is the root (stable)
    }
  }
}

const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

/** Run the resolve stage: generate candidate pairs (same-type, sharing a surface
 *  signal), decide each, cluster the accepted merges, and materialize reversible
 *  resolutions. Entities are deep-copied; only `resolved_from`/`merged_into` pointers
 *  are added, so `unresolve` restores the pre-merge state exactly (spec 01 §7). */
export async function resolveEntities(
  input: { entities: Record<string, EntityOut>; entity_types: Record<string, EntityTypeOut> },
  gateway: ModelGateway,
  config: ResolveConfig,
  _stage: StageSettings = {},
): Promise<ResolveOutput> {
  const entities: Record<string, EntityOut> = JSON.parse(JSON.stringify(input.entities));
  const ids = Object.keys(entities).sort();

  const dsu = new DSU();
  const edges: Array<{ a: string; b: string; d: Decision }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = entities[ids[i]];
      const b = entities[ids[j]];
      if (a.type_id !== b.type_id) continue; // block by type
      if (similarity(surfaces(a), surfaces(b)) === 0) continue; // not a candidate
      const d = await decidePair(a, b, gateway, config);
      if (d.accept) {
        edges.push({ a: ids[i], b: ids[j], d });
        dsu.union(ids[i], ids[j]);
      }
    }
  }

  const clusters = new Map<string, Set<string>>();
  for (const e of edges) {
    const root = dsu.find(e.a);
    const set = clusters.get(root) ?? new Set<string>();
    set.add(e.a);
    set.add(e.b);
    clusters.set(root, set);
  }

  const resolutions: Record<string, ResolutionOut> = {};
  let merged = 0;
  for (const set of clusters.values()) {
    const members = [...set].sort();
    if (members.length < 2) continue;

    const canonical = members
      .slice()
      .sort((x, y) => {
        const dx = entities[x].provenance.fact_ids.length;
        const dy = entities[y].provenance.fact_ids.length;
        return dy - dx || (x < y ? -1 : 1);
      })[0];
    const others = members.filter((m) => m !== canonical);

    const evidenceFacts = uniqSorted(members.flatMap((m) => entities[m].provenance.fact_ids));
    const clusterEdges = edges.filter((e) => set.has(e.a) && set.has(e.b));
    const minConf = Math.min(...clusterEdges.map((e) => e.d.confidence));
    const verified = clusterEdges.some((e) => e.d.method === "agent+verified");

    const resolutionId = "r_" + sha12(uniqSorted(members).join(","));
    resolutions[resolutionId] = {
      resolution_id: resolutionId,
      canonical,
      members: others,
      evidence: { fact_ids: evidenceFacts, rationale: `Resolved ${members.length} surface forms of the same entity.` },
      confidence: Number(minConf.toFixed(4)),
      method: verified ? "agent+verified" : "agent",
      ...(verified ? { verified_by: "judge" as const } : {}),
      reversible: true,
    };

    // Reversible materialization: pointers only (union is at read time, spec 06).
    entities[canonical].resolved_from = uniqSorted([...(entities[canonical].resolved_from ?? []), ...others]);
    for (const m of others) entities[m].merged_into = canonical;
    merged += others.length;
  }

  return { entities, resolutions, merged };
}

/** Reverse resolutions (spec 04 · reversibility, gate G5). Removes the resolution
 *  records and the `resolved_from`/`merged_into` pointers they added, restoring the
 *  independent entities. Never a history rewrite — a forward Operation. */
export function unresolve(
  entities: Record<string, EntityOut>,
  resolutions: Record<string, ResolutionOut>,
  ids: string[],
): { entities: Record<string, EntityOut>; resolutions: Record<string, ResolutionOut> } {
  const outE: Record<string, EntityOut> = JSON.parse(JSON.stringify(entities));
  const outR: Record<string, ResolutionOut> = { ...resolutions };
  for (const id of ids) {
    const r = outR[id];
    if (!r) continue;
    delete outR[id];
    const c = outE[r.canonical];
    if (c?.resolved_from) {
      c.resolved_from = c.resolved_from.filter((m) => !r.members.includes(m));
      if (c.resolved_from.length === 0) delete c.resolved_from;
    }
    for (const m of r.members) {
      const me = outE[m];
      if (me && me.merged_into === r.canonical) delete me.merged_into;
    }
  }
  return { entities: outE, resolutions: outR };
}
