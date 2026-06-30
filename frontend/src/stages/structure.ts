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
  '    "done_when"?: string, "fidelity": "claimed"|"guessed" } ],\n' +
  '  "views": [ { "view_id": string, "title": string, "url_patterns"?: [string], "node_ids": [string], "fidelity": "claimed"|"guessed" } ],\n' +
  '  "edges": [ { "from": string, "to": string, "kind": "contains"|"transition"|"enables"|"depends_on"|"next"|"related_to", "label"?: string, "fidelity": "claimed"|"guessed" } ]\n' +
  "}\n\n" +
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
  "Return JSON: { \"locals\": [ { \"source_id\": string, \"nodes\": [...], \"views\": [...], " +
  "\"edges\": [...] } ] } where each local's nodes/views/edges have EXACTLY the per-source " +
  "shape:\n" +
  '  node:  { "id","title","summary","kind","view_id"?,"fact_ids":[..],"action"?,"checks"?,"done_when"?,"fidelity" }\n' +
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

export async function structure(
  sourceId: string,
  facts: BcFact[],
  ctx: { profile: string; urlPatterns: string[] },
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<LocalObject> {
  const context = {
    profile: ctx.profile,
    sourceId,
    urlPatterns: ctx.urlPatterns,
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
export async function structureBatch(
  sources: Array<{ sourceId: string; facts: BcFact[] }>,
  ctx: { profile: string; urlPatterns: string[] },
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<LocalObject[]> {
  if (sources.length === 0) return [];

  const result = await gateway.extract({
    label: "structure",
    instruction: STRUCTURE_BATCH_INSTRUCTION,
    content: JSON.stringify({
      profile: ctx.profile,
      urlPatterns: ctx.urlPatterns,
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
