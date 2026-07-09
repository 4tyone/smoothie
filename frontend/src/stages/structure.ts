// structure (agent) — a *local* stage (spec 03 · structure). It turns ONE
// source's facts into a local object: nodes (profile vocabulary), first-class
// views, and within-source edges. Connecting objects across sources is `link`'s
// job; Brief-shaped outlines are reconciled there too.
//
// The model proposes the shape; CODE materializes provenance — every node and
// edge gets `source_refs` from the facts it rests on, so the graph is receipted
// by construction (the provenance guarantee), not by the model's word.

import { StructureResult, StructureBatchResult } from "../bc/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { BcFact } from "./describe.ts";
import type { StageSettings } from "../config.ts";

/** Per-stage model/thinking → the optional fields `gateway.extract` understands. */
const tuning = (s: StageSettings = {}) => ({
  ...(s.model ? { model: s.model } : {}),
  ...(s.thinking ? { reasoning: s.thinking } : {}),
});

const STRUCTURE_INSTRUCTION =
  "You are the structure stage. The user message is JSON with { profile, briefId, " +
  "urlPatterns, sourceId, facts[] } for a SINGLE source. Build a LOCAL graph that " +
  "references ONLY the provided fact_ids. Do not invent facts. Use the profile's node " +
  "vocabulary (web-app: screen|feature|flow|action; corpus: topic). Do not build " +
  "outlines (that happens later).\n\n" +
  "Return JSON of exactly this shape:\n" +
  "{\n" +
  '  "nodes": [ { "id": string, "title": string, "summary": string|null,\n' +
  '    "kind": "screen"|"feature"|"flow"|"action"|"topic", "view_id"?: string,\n' +
  '    "fact_ids": [string],                       // a subset of the provided fact_ids\n' +
  '    "action"?: { "kind": "goto"|"click"|"fill"|"select"|"press",\n' +
  '       "url"?: string,                          // for goto: an absolute URL within urlPatterns[0]\n' +
  '       "locator"?: { "description": string, "primary": { "by": "text"|"role"|"testid"|"label"|"css", "value": string } } },\n' +
  '    "checks"?: [ { "kind": "visible"|"exists"|"text_matches"|"url_matches", "expected"?: string,\n' +
  '       "locator"?: { "description": string, "primary": { "by": "text"|"role"|"testid"|"label"|"css", "value": string } } } ],\n' +
  '    "done_when"?: string, "fidelity": "claimed"|"guessed",\n' +
  '    "goal_ids"?: [string] } ],                    // ids of the Brief goals this node serves (0+); [] if none\n' +
  '  "views": [ { "view_id": string, "title": string, "url_patterns"?: [string], "node_ids": [string], "fidelity": "claimed"|"guessed" } ],\n' +
  '  "edges": [ { "from": string, "to": string, "kind": "contains"|"transition"|"enables"|"depends_on"|"next"|"related_to", "label"?: string, "fidelity": "claimed"|"guessed" } ]\n' +
  "}\n\n" +
  "The user message includes `goals` (the Brief's goals, each { id, text }). For every node, " +
  "set `goal_ids` to the goal ids that node genuinely helps answer — judge by MEANING, not " +
  "shared words; a node may serve several goals or none. This is how each goal's outline is " +
  "built, so be accurate. " +
  "Prefix node ids and view ids with the sourceId so they are globally unique. " +
  "For a web-app action node, ALWAYS include a non-empty locator value. " +
  "If a document/view CONTAINS topics, list them in that view's `node_ids` — do NOT " +
  "emit `contains` edges from a view id (edges connect nodes, not views). " +
  "Do not include any other keys.";

// Batched structure: one call structures EVERY new source (fewer round-trips,
// leverages the context window). Same per-source contract, returned as a list.
const STRUCTURE_BATCH_INSTRUCTION =
  "You are the structure stage. The user message is JSON with { profile, urlPatterns, " +
  "sources: [ { sourceId, facts[] } ] } — possibly MANY sources. For EACH source, build " +
  "a LOCAL graph referencing ONLY that source's fact_ids (never mix fact_ids across " +
  "sources; cross-source connection happens later at `link`). Use the profile's node " +
  "vocabulary (web-app: screen|feature|flow|action; corpus: topic). Do not build outlines.\n\n" +
  "The user message includes `goals` (the Brief's goals, each { id, text }). For every node, " +
  "set `goal_ids` to the goal ids that node genuinely helps answer — judge by MEANING, not " +
  "shared words; a node may serve several goals or none. This drives each goal's outline.\n\n" +
  "Return JSON: { \"locals\": [ { \"source_id\": string, \"nodes\": [...], \"views\": [...], " +
  "\"edges\": [...] } ] } where each local's nodes/views/edges have EXACTLY the per-source " +
  "shape:\n" +
  '  node:  { "id","title","summary","kind","view_id"?,"fact_ids":[..],"action"?,"checks"?,"done_when"?,"fidelity","goal_ids"?:[..] }\n' +
  '  view:  { "view_id","title","url_patterns"?,"node_ids":[..],"fidelity" }\n' +
  '  edge:  { "from","to","kind":"contains"|"transition"|"enables"|"depends_on"|"next"|"related_to","label"?,"fidelity" }\n' +
  "Prefix every node id and view id with its sourceId so ids are globally unique. " +
  "Emit one `local` per input source. If a view CONTAINS topics, list them in the view's " +
  "`node_ids` — do NOT emit `contains` edges from a view id. Do not include any other keys.";

/** A local object — one source's structured nodes/views/edges, provenance-materialized. */
export interface LocalObject {
  source_id: string;
  nodes: Array<Record<string, unknown> & { id: string; fact_ids: string[]; source_refs: unknown[] }>;
  edges: Array<Record<string, unknown> & { from: string; to: string; source_refs: unknown[] }>;
  views: Array<Record<string, unknown> & { view_id: string; node_ids: string[] }>;
  gaps: Array<{ key: string; kind?: string; text: string }>;
}

/** Structure context — the profile vocabulary, url patterns, and the Brief goals
 *  the model tags nodes against (for goal-scoped outlines built at `link`). */
export interface StructureCtx {
  profile: string;
  urlPatterns: string[];
  goals?: Array<{ id: string; text: string }>;
}

export async function structure(
  sourceId: string,
  facts: BcFact[],
  ctx: StructureCtx,
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<LocalObject> {
  const context = {
    profile: ctx.profile,
    sourceId,
    urlPatterns: ctx.urlPatterns,
    goals: ctx.goals ?? [],
    facts: facts.map((f) => ({ fact_id: f.fact_id, kind: f.kind, text: f.text, action_draft: f.action_draft })),
  };

  const result = await gateway.extract({
    label: "structure",
    instruction: STRUCTURE_INSTRUCTION,
    content: JSON.stringify(context),
    schema: StructureResult,
    ...tuning(stage),
  });

  return materializeLocal(sourceId, facts, result);
}

/** Batched structure — ONE model call structures every new source (fewer
 *  round-trips, leverages the context window). Returns one LocalObject per source;
 *  any source the model omits falls back to a per-source {@link structure} call so
 *  no source is silently dropped. */
/** How many sources' facts go into ONE structure call. Batching all sources at
 *  once blows the model's OUTPUT budget on a large corpus (the cat_case_study run
 *  truncated `structure` at ~69 sources → "Unexpected end of JSON input" → aborted
 *  compile). Chunking bounds each call's output. Tune with `SMOOTHIE_STRUCTURE_CHUNK`. */
function structureChunkSize(): number {
  const n = Number(process.env.SMOOTHIE_STRUCTURE_CHUNK);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}

/** How many structure chunks run at once. Chunks are independent (each → its own
 *  local objects), so they fan out like `describe` — sequential chunking made the
 *  cat_case_study structure stage a ~36-min bottleneck. Tune with
 *  `SMOOTHIE_STRUCTURE_CONCURRENCY`. */
function structureConcurrency(): number {
  const n = Number(process.env.SMOOTHIE_STRUCTURE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** Run `fn` over `items` with at most `limit` in flight; results stay in INPUT
 *  order so the merged locals are deterministic. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}

/** Max facts fed to ONE structure call per source. A fact-heavy source (a 10-K or
 *  transcript with 200+ facts) makes structure emit so many nodes that the model's
 *  OUTPUT truncates → the source is dropped. Capping the INPUT bounds the output so
 *  EVERY source is represented in the graph. This is lossless for the fact pool —
 *  describe already wrote all facts to the BC; the cap only limits how many become
 *  nodes. Tune with `SMOOTHIE_STRUCTURE_MAX_FACTS` (0 = uncapped). */
function structureMaxFacts(): number {
  const n = Number(process.env.SMOOTHIE_STRUCTURE_MAX_FACTS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; // uncapped by default
}

export async function structureBatch(
  sources: Array<{ sourceId: string; facts: BcFact[] }>,
  ctx: StructureCtx,
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<LocalObject[]> {
  if (sources.length === 0) return [];

  // Bound each source's facts so structure's output can't truncate (drop the source).
  const cap = structureMaxFacts();
  if (cap > 0) sources = sources.map((s) => (s.facts.length > cap ? { ...s, facts: s.facts.slice(0, cap) } : s));

  // Chunk so a large corpus never overflows one call's output — and run the chunks
  // CONCURRENTLY (they're independent), assembling in source order. A chunk whose
  // batched call fails (the model emits malformed/truncated JSON on a big array)
  // is NOT fatal: fall back to per-source structuring (much smaller, more reliable
  // outputs), and a source that still fails is skipped, never aborting the compile.
  const chunk = structureChunkSize();
  if (sources.length > chunk) {
    const chunks: Array<Array<{ sourceId: string; facts: BcFact[] }>> = [];
    for (let i = 0; i < sources.length; i += chunk) chunks.push(sources.slice(i, i + chunk));
    const results = await mapPool(chunks, structureConcurrency(), async (c) => {
      try {
        return await structureBatch(c, ctx, gateway, stage);
      } catch (e) {
        process.stderr.write(`⚠ smoothie: structure chunk failed (${(e as Error).message}) — retrying its ${c.length} source(s) individually\n`);
        const out: LocalObject[] = [];
        for (const s of c) {
          try {
            out.push(await structure(s.sourceId, s.facts, ctx, gateway, stage));
          } catch (e2) {
            process.stderr.write(`⚠ smoothie: structure failed for ${s.sourceId} — skipped: ${(e2 as Error).message}\n`);
          }
        }
        return out;
      }
    });
    return results.flat();
  }

  const result = await gateway.extract({
    label: "structure",
    instruction: STRUCTURE_BATCH_INSTRUCTION,
    content: JSON.stringify({
      profile: ctx.profile,
      urlPatterns: ctx.urlPatterns,
      goals: ctx.goals ?? [],
      sources: sources.map((s) => ({
        sourceId: s.sourceId,
        facts: s.facts.map((f) => ({ fact_id: f.fact_id, kind: f.kind, text: f.text, action_draft: f.action_draft })),
      })),
    }),
    schema: StructureBatchResult,
    ...tuning(stage),
  });

  const factsBySource = new Map(sources.map((s) => [s.sourceId, s.facts]));
  const byId = new Map(result.locals.map((lo) => [lo.source_id, lo]));
  const locals: LocalObject[] = [];
  for (const s of sources) {
    const lo = byId.get(s.sourceId);
    // Fallback: the model dropped this source → structure it on its own (never
    // silently lose a source).
    locals.push(lo
      ? materializeLocal(s.sourceId, s.facts, lo)
      : await structure(s.sourceId, s.facts, ctx, gateway, stage));
  }
  return locals;
}

/** Materialize provenance for one source's raw structure output and guard the
 *  edge contract in CODE (not the prompt). */
function materializeLocal(
  sourceId: string,
  facts: BcFact[],
  result: { nodes: StructureResult["nodes"]; views: StructureResult["views"]; edges: StructureResult["edges"]; gaps?: StructureResult["gaps"] },
): LocalObject {
  const factRefs = new Map(facts.map((f) => [f.fact_id, f.source_refs]));
  const materializeNodeRefs = (factIds: string[]): unknown[] => {
    const seen = new Set<string>();
    const refs: unknown[] = [];
    for (const fid of factIds) {
      for (const ref of factRefs.get(fid) ?? []) {
        const key = JSON.stringify(ref);
        if (!seen.has(key)) { seen.add(key); refs.push(ref); }
      }
    }
    return refs;
  };

  const nodes = result.nodes.map((n) => ({ ...n, source_refs: materializeNodeRefs(n.fact_ids) }));
  const nodeRefs = new Map(nodes.map((n) => [n.id, n.source_refs]));
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Every edge endpoint MUST be a real node (the SVM's receipt gate rejects a BC
  // otherwise). The model sometimes expresses document containment as `contains`
  // edges FROM a view id (e.g. `<src>-view-document`). Rather than DROP that signal
  // (which would orphan the view), RECOVER it: fold the node endpoint into the
  // view's `node_ids` — where containment belongs — then drop the edge below.
  const viewById = new Map((result.views ?? []).map((vw) => [vw.view_id, vw]));
  for (const e of result.edges) {
    const fromNode = nodeIds.has(e.from), toNode = nodeIds.has(e.to);
    if (fromNode && toNode) continue; // real node→node edge, kept below
    const view = viewById.get(e.from) ?? viewById.get(e.to);
    const member = fromNode ? e.from : toNode ? e.to : undefined;
    if (view && member && !view.node_ids.includes(member)) view.node_ids.push(member);
  }
  const edges = result.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      ...e,
      source_refs: (nodeRefs.get(e.from) ?? nodeRefs.get(e.to) ?? []) as unknown[],
    }));

  return {
    source_id: sourceId,
    nodes: nodes as LocalObject["nodes"],
    edges: edges as LocalObject["edges"],
    views: result.views as LocalObject["views"],
    gaps: result.gaps ?? [],
  };
}
