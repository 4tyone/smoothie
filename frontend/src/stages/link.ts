// link (agent) — the connection stage (spec 03 · link). Where disparate sources
// become one graph. Given freshly structured local objects and the existing
// graph, the linker:
//   1. merges duplicate identities (same view across sources → one view, two receipts);
//   2. induces cross-source edges (typed connections the within-source pass missed),
//      at `guessed` fidelity, citing BOTH endpoints' receipts (spec 02 · Edge);
//   3. reconciles outlines into Brief-shaped flows;
//   4. records orphans it could not connect as `gap:` notes — never a forced edge.
//
// It is **incremental by construction**: a new source weaves into the existing
// graph and **nothing already in the BC is rewritten** — existing nodes are
// carried over verbatim (spec 03 · incremental). The model proposes connections;
// CODE applies them and materializes provenance.

import * as fs from "node:fs";
import { LinkResult } from "../bc/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { BcFact } from "./describe.ts";
import type { LocalObject } from "./structure.ts";
import type { StageSettings } from "../config.ts";
import { runLinkAgent } from "../agent/link-agent.ts";

type Obj = Record<string, unknown>;
type NodeObj = Obj & { id: string; view_id?: string; source_refs: unknown[] };
type EdgeObj = Obj & { from: string; to: string; source_refs: unknown[] };
type ViewObj = Obj & { view_id: string; node_ids: string[] };
type Gap = { key: string; kind?: string; text: string };


/** The graph already in the BC (empty for a cold compile). */
export interface ExistingGraph {
  sources: Record<string, unknown>;
  facts: BcFact[];
  nodes: NodeObj[];
  edges: EdgeObj[];
  views: ViewObj[];
  gaps: Gap[];
  /** Ids of nodes that must be carried over verbatim (the incremental guarantee). */
  existingNodeIds: Set<string>;
}

export function emptyExisting(): ExistingGraph {
  return { sources: {}, facts: [], nodes: [], edges: [], views: [], gaps: [], existingNodeIds: new Set() };
}

/** The source a node/fact belongs to, read from its code-owned first receipt
 *  (never id-prefix guessing, which misfires when one id prefixes another). */
export function sourceOfRefs(refs: unknown): string | null {
  const first = Array.isArray(refs) ? (refs[0] as { source_id?: string } | undefined) : undefined;
  return first?.source_id ?? null;
}

/** Remove every artifact belonging to `sourceIds` from an ExistingGraph, so a
 *  CHANGED source can be re-described and re-woven without leaving stale nodes,
 *  facts, or edges behind (spec 03 · incremental; the delete-then-rebuild an
 *  edit implies). Attribution is by receipt, so it is exact. */
export function evictSources(existing: ExistingGraph, sourceIds: Set<string>): ExistingGraph {
  if (sourceIds.size === 0) return existing;
  const keptNodes = existing.nodes.filter((n) => !(sourceOfRefs(n.source_refs) && sourceIds.has(sourceOfRefs(n.source_refs)!)));
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptFacts = existing.facts.filter((f) => !(sourceOfRefs(f.source_refs) && sourceIds.has(sourceOfRefs(f.source_refs)!)));
  const keptEdges = existing.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));
  // A view survives with its members filtered to surviving nodes; drop it if empty.
  const keptViews = existing.views
    .map((vw) => ({ ...vw, node_ids: (vw.node_ids ?? []).filter((id) => keptIds.has(id)) }))
    .filter((vw) => vw.node_ids.length > 0);
  const sources = { ...existing.sources };
  for (const sid of sourceIds) delete sources[sid];
  return {
    sources,
    facts: keptFacts,
    nodes: keptNodes,
    edges: keptEdges,
    views: keptViews,
    gaps: existing.gaps,
    existingNodeIds: keptIds,
  };
}

/** Load a prior `bc.json` into an ExistingGraph for incremental weaving. */
export function loadExisting(bcPath: string): ExistingGraph {
  const bc = JSON.parse(fs.readFileSync(bcPath, "utf8"));
  const nodes = Object.values(bc.graph?.nodes ?? {}) as NodeObj[];
  const gaps: Gap[] = Object.entries(bc.notes ?? {})
    .filter(([k]) => k.startsWith("gap:"))
    .map(([key, n]) => ({ key, kind: (n as Obj).kind as string | undefined, text: (n as Obj).text as string }));
  return {
    sources: bc.sources ?? {},
    facts: Object.values(bc.facts ?? {}) as BcFact[],
    nodes,
    edges: (bc.graph?.edges ?? []) as EdgeObj[],
    views: Object.values(bc.views ?? {}) as ViewObj[],
    gaps,
    existingNodeIds: new Set(nodes.map((n) => n.id)),
  };
}

/** The fully merged graph that `compile` serializes + validates. */
export interface MergedGraph {
  sources: Record<string, unknown>;
  facts: BcFact[];
  nodes: NodeObj[];
  edges: EdgeObj[];
  views: ViewObj[];
  outlines: Array<Obj & { outline_id: string }>;
  gaps: Gap[];
  /** Carried-over node ids (for the "not rewritten" guarantee / telemetry). */
  carriedOverNodeIds: string[];
}

const LINK_INSTRUCTION =
  "You are the link stage of a multimodal data compiler. The user message is JSON " +
  "with { existing_nodes, new_nodes, existing_views, new_views }. Each node is " +
  "{ id, title, source, summary, facts: [representative fact text] }; each view is " +
  "{ view_id, title }. Reason over the SUMMARIES and FACTS — not titles alone — to find " +
  "real connections. Connect the NEW material into the graph WITHOUT changing existing nodes.\n\n" +
  "Be thorough: weigh every pair of nodes from DIFFERENT sources and induce an edge wherever " +
  "the summaries/facts show a genuine relationship — a concept explained in one source and " +
  "applied or exemplified in another, a measure that feeds a calculation, a standard that " +
  "governs a line item. Prefer the MOST SPECIFIC edge kind (enables / depends_on over a generic " +
  "related_to). Never invent a relationship the evidence does not support — a node with no real " +
  "connection is an `orphan`, not a forced edge.\n\n" +
  "Return JSON of exactly this shape:\n" +
  "{\n" +
  '  "view_merges": [ { "from": <a NEW view_id>, "into": <any view_id it is the same screen/state as> } ],\n' +
  '  "induced_edges": [ { "from": <nodeId>, "to": <nodeId>, "kind": "contains"|"transition"|"enables"|"depends_on"|"next"|"related_to", "label"?: string } ],\n' +
  '  "orphans": [ { "node_id": <a NEW nodeId you could not connect>, "reason": string } ]\n' +
  "}\n\n" +
  "Only merge NEW views (never an existing view into something). Induce an edge only " +
  "when at least one endpoint is a NEW node (cross-source). Do not include other keys.";

export async function link(
  existing: ExistingGraph,
  newSources: Record<string, unknown>,
  newFacts: BcFact[],
  newLocals: LocalObject[],
  ctx: { profile: string; briefId: string; goals: Array<{ id: string; text: string; done_when?: string }> },
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<MergedGraph> {
  // Working set: existing first (carried over verbatim), then the new locals.
  const nodes: NodeObj[] = [...existing.nodes];
  const edges: EdgeObj[] = [...existing.edges];
  const views: ViewObj[] = [...existing.views];
  const gaps: Gap[] = [...existing.gaps];
  const newNodeIds = new Set<string>();

  for (const lo of newLocals) {
    for (const n of lo.nodes) { nodes.push(n as NodeObj); newNodeIds.add(n.id); }
    for (const e of lo.edges) edges.push(e as EdgeObj);
    for (const view of lo.views) views.push(view as ViewObj);
    for (const g of lo.gaps) gaps.push(g);
  }

  const refOf = new Map(nodes.map((n) => [n.id, n.source_refs]));
  const viewOf = new Map(views.map((vw) => [vw.view_id, vw]));

  // Enrich each node with its summary + a few representative facts + its source, so
  // the linker connects on real content (not titles alone) and knows what counts as
  // cross-source. The context window is large; spend it here — this is where the
  // connection thesis lives.
  const factText = new Map<string, string>();
  for (const f of [...existing.facts, ...newFacts]) factText.set(f.fact_id, f.text);
  const sourceIds = [...Object.keys(existing.sources), ...Object.keys(newSources)];
  const sourceOf = (id: string): string | null =>
    sourceIds.find((sid) => id === sid || id.startsWith(`${sid}-`)) ?? null;
  const enrich = (n: NodeObj) => ({
    id: n.id,
    title: n.title as string,
    view_id: n.view_id,
    source: sourceOf(n.id),
    summary: (n.summary as string | undefined) ?? null,
    facts: (((n as Obj).fact_ids as string[] | undefined) ?? [])
      .slice(0, 5)
      .map((fid) => factText.get(fid))
      .filter((t): t is string => Boolean(t)),
  });

  const newNodeList = [...newNodeIds].map((id) => nodes.find((x) => x.id === id)!);

  // Ask the model how to connect. Two paths:
  //   • REAL gateway → a lazy-loading NAVIGATION AGENT (link-agent.ts): it explores
  //     the graph through tools, holding only its working set, and proposes edges
  //     incrementally. This scales to a large corpus where one giant call times out.
  //   • DETERMINISTIC gateway (CI) → the single-call form below, so "same input →
  //     same BC" stays byte-stable.
  // Either way, if it fails, DON'T abort — fall back to no cross-source linking (each
  // source's local graph is kept; the BC is valid, just without induced edges).
  let decision: LinkResult;
  try {
    if (gateway.extractWithTools) {
      const navNodes = nodes.map((n) => ({
        id: n.id, title: n.title as string, source: sourceOfRefs(n.source_refs),
        view_id: n.view_id, isNew: newNodeIds.has(n.id),
        summary: (n.summary as string | undefined) ?? null,
        facts: (((n as Obj).fact_ids as string[] | undefined) ?? []).slice(0, 5)
          .map((fid) => factText.get(fid)).filter((t): t is string => Boolean(t)),
      }));
      const navViews = views.map((vw) => ({ view_id: vw.view_id, title: vw.title as string }));
      decision = await runLinkAgent({ nodes: navNodes, views: navViews, goals: ctx.goals }, gateway, stage) as LinkResult;
    } else {
    decision = await gateway.extract({
      label: "link",
      instruction: LINK_INSTRUCTION,
      // cross-graph synthesis earns more reasoning than the per-source stages (config-tunable)
      reasoning: stage.thinking ?? "medium",
      ...(stage.model ? { model: stage.model } : {}),
      content: JSON.stringify({
        existing_nodes: existing.nodes.map(enrich),
        new_nodes: newNodeList.map(enrich),
        existing_views: existing.views.map((vw) => ({ view_id: vw.view_id, title: vw.title })),
        new_views: newLocals.flatMap((lo) => lo.views).map((vw) => ({ view_id: vw.view_id, title: vw.title })),
      }),
      schema: LinkResult,
    });
    }
  } catch (e) {
    process.stderr.write(`⚠ smoothie: link failed (${(e as Error).message}) — proceeding WITHOUT cross-source linking (local graphs kept; no induced edges)\n`);
    decision = { view_merges: [], induced_edges: [], orphans: [] };
  }

  // 1 · merge duplicate views — only NEW views fold away; existing nodes untouched.
  for (const m of decision.view_merges ?? []) {
    const from = viewOf.get(m.from);
    const into = viewOf.get(m.into);
    if (!from || !into || from === into) continue;
    if (existing.existingNodeIds.size && existing.views.some((vw) => vw.view_id === m.from)) continue; // don't dissolve an existing view
    for (const nid of from.node_ids) {
      if (!into.node_ids.includes(nid)) into.node_ids.push(nid);
      const node = nodes.find((n) => n.id === nid);
      if (node && !existing.existingNodeIds.has(node.id)) node.view_id = into.view_id; // only reassign NEW nodes
    }
    from.node_ids = []; // emptied; dropped below
  }
  const liveViews = views.filter((vw) => vw.node_ids.length > 0);

  // 2 · induce cross-source edges — `guessed`, citing both endpoints' receipts.
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const ie of decision.induced_edges ?? []) {
    if (!nodeIds.has(ie.from) || !nodeIds.has(ie.to) || ie.from === ie.to) continue;
    if (!newNodeIds.has(ie.from) && !newNodeIds.has(ie.to)) continue; // must touch new material
    const refs = dedupeRefs([...(refOf.get(ie.from) ?? []), ...(refOf.get(ie.to) ?? [])]);
    edges.push({ from: ie.from, to: ie.to, kind: ie.kind, ...(ie.label ? { label: ie.label } : {}), fidelity: "guessed", source_refs: refs } as EdgeObj);
  }

  // 3 · reconcile outlines — one Brief-shaped outline per goal, scoped to the nodes
  // the MODEL tagged with that goal (`goal_ids`, set during structure by semantic
  // judgment). Grouping here is pure code, but the RELEVANCE decision is the model's
  // — no lexical keyword matching. A goal no node serves gets an empty scene (honest:
  // the corpus doesn't cover it), never the whole graph.
  const outlines = ctx.goals.map((g) => {
    const nodeIds = nodes
      .filter((n) => (((n as Obj).goal_ids as string[] | undefined) ?? []).includes(g.id))
      .map((n) => n.id as string);
    return {
      outline_id: `o-${g.id}`,
      brief_id: ctx.briefId,
      title: g.text.slice(0, 80),
      fidelity: "claimed",
      scenes: [{ scene_id: `s-${g.id}`, title: g.text.slice(0, 80), node_ids: nodeIds, ...(g.done_when ? { done_when: g.done_when } : {}), fidelity: "claimed" }],
    };
  });

  // 4 · orphans → gap notes (deduped by key).
  for (const o of decision.orphans ?? []) {
    const key = `gap:orphan-${o.node_id}`;
    if (!gaps.some((x) => x.key === key)) gaps.push({ key, kind: "knowledge", text: o.reason });
  }

  // Final receipt guard (defense-in-depth): the merged graph may only contain
  // edges between real nodes. Structure-local edges are guarded at their source,
  // but enforce the invariant once more here at assembly so no edge with a view
  // id (or a stale/merged-away node id) as an endpoint can reach the BC and trip
  // the SVM's receipt gate. Containment is carried by `views[].node_ids`.
  const liveNodeIds = new Set(nodes.map((n) => n.id));
  const cleanEdges = edges.filter((e) => liveNodeIds.has(e.from) && liveNodeIds.has(e.to));

  return {
    sources: { ...existing.sources, ...newSources },
    facts: [...existing.facts, ...newFacts],
    nodes,
    edges: cleanEdges,
    views: liveViews,
    outlines,
    gaps,
    carriedOverNodeIds: [...existing.existingNodeIds],
  };
}

function dedupeRefs(refs: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const r of refs) {
    const k = JSON.stringify(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}
