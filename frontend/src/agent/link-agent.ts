// The LINK stage as a table-of-contents navigation agent (spec 03 · link).
//
// Cross-source linking is an O(n²) REASONING problem, not a data-size one — asking
// one model call to find every connection among all nodes saturates its reasoning
// budget. The fix is to give the agent GLOBAL AWARENESS cheaply (a table of
// contents: one compact line per node) so it can SEE the whole graph at once and
// spot which nodes across sources might connect — then lazy-load full detail only
// for those candidates, judge, and propose. The agent has its own loop: it can
// re-read the TOC, drill into a source, pull node detail, or jump back — navigating
// nested levels freely instead of holding everything in context.
//
// The model makes every SEMANTIC judgment (does this connect? same view? orphan?);
// CODE still materializes receipts from the proposals (provenance guarantee intact).

import * as v from "valibot";
import { Type } from "@earendil-works/pi-ai";
import type { ModelGateway, AgentTool } from "../model/gateway.ts";
import type { StageSettings } from "../config.ts";
import { EDGE_KINDS } from "../bc/schemas.ts";

/** A node as the link agent sees it (its structured-graph shape, not bc.v1). */
export interface NavNode {
  id: string;
  title: string;
  source: string | null;
  view_id?: string;
  isNew: boolean;
  summary: string | null;
  facts: string[];
}
export interface NavView { view_id: string; title: string }

/** The decisions the agent proposes — same shape the stage already applies. */
export interface LinkDecision {
  view_merges: Array<{ from: string; into: string }>;
  induced_edges: Array<{ from: string; to: string; kind: string; label?: string }>;
  orphans: Array<{ node_id: string; reason: string }>;
}

/** Max node ids read for detail in one `read_nodes` call (bounds each turn's payload). */
const READ_BATCH = 30;
/** Char budget for the FLAT table of contents. Above it, the TOC degrades to a
 *  source-level index (level 0) the agent drills into — the same idea, one level up. */
const FLAT_TOC_MAX_CHARS = 120_000;
/** Agent step budget — scales with graph size so a big corpus gets enough turns. */
const stepBudget = (nodes: number): number => Math.min(300, Math.max(50, Math.ceil(nodes / 6)));

const SYSTEM =
  "You are the LINK stage of a multimodal data compiler. Every source has already been structured " +
  "into local nodes; your job is to find CROSS-SOURCE connections — the same fact asserted in two " +
  "sources, a step shown in one source and described in another, a topic that spans sources, or " +
  "duplicate views that are really one screen/state.\n\n" +
  "You have a TABLE OF CONTENTS: a compact one-line index of every node (id, source, title). Use it " +
  "to see the whole graph at once and spot nodes ACROSS sources that might connect — you don't reason " +
  "over every pair, you scan the index and pick candidate clusters. Your tools:\n" +
  "  • read_toc() — the global node index (or, for a very large graph, the source index to drill into).\n" +
  "  • read_toc(source_id) — one source's node index (id + title), to drill into a source.\n" +
  "  • read_nodes(ids) — full detail (summary + representative facts) for up to 30 nodes, to judge a link.\n" +
  "  • propose_edge(from, to, kind, label?) — record a real cross-source relationship.\n" +
  "  • propose_merge(from_view, into_view) — fold a duplicate view into another.\n" +
  "  • mark_orphan(node_id, reason) — a node you genuinely cannot connect (a gap, not a forced edge).\n\n" +
  "Work like this: scan the TOC, group nodes that plausibly relate (same period, entity, or claim across " +
  "different sources), then read_nodes on a candidate group and propose the connections that are genuinely " +
  "there. You can navigate freely — re-read the TOC, drill into any source, re-read any nodes, jump back. " +
  "Judge every connection by MEANING, never shared words; at least one endpoint of an induced edge should " +
  "be new material; precision over recall. When you have worked through the graph, stop.";

/** Run the link stage as a TOC navigation agent, returning the proposed decisions.
 *  Only used with a real (tool-capable) gateway; the deterministic path uses the
 *  single-call form in link.ts so "same input → same BC" stays byte-stable. */
export async function runLinkAgent(
  input: { nodes: NavNode[]; views: NavView[]; goals: Array<{ id: string; text: string }> },
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<LinkDecision> {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const bySource = new Map<string, NavNode[]>();
  for (const n of input.nodes) {
    const s = n.source ?? "?";
    const list = bySource.get(s) ?? [];
    list.push(n);
    bySource.set(s, list);
  }
  const validViews = new Set(input.views.map((vw) => vw.view_id));
  const decision: LinkDecision = { view_merges: [], induced_edges: [], orphans: [] };

  // The table of contents: one line per node (`* ` marks NEW material). If it fits
  // the budget, the agent gets global awareness in a single read; if not, it falls
  // back to a source-level index the agent drills into with list_nodes.
  const tocLine = (n: NavNode) => `${n.isNew ? "* " : "  "}${n.id} [${n.source ?? "?"}]  ${n.title}`;
  const flatToc = input.nodes.map(tocLine).join("\n");
  const flatFits = flatToc.length <= FLAT_TOC_MAX_CHARS;
  const sourceIndex = [...bySource.entries()].map(([s, ns]) => `  ${s} — ${ns.length} nodes`).join("\n");
  const tocText = () =>
    flatFits
      ? `# Table of contents — ${input.nodes.length} nodes ("* " = new material)\n${flatToc}`
      : `# Graph too large for a flat TOC (${input.nodes.length} nodes). Source index — drill in with list_nodes(source_id):\n${sourceIndex}`;

  const tools: AgentTool[] = [
    {
      name: "read_toc",
      description: "The table of contents. With no argument: a compact one-line index of every node (id, source, title) — the whole graph, to spot cross-source clusters (for a very large graph, the source index instead). With a source_id: that one source's node index, to drill in.",
      parameters: Type.Object({ source_id: Type.Optional(Type.String({ description: "optional — a source_id to drill into; omit for the global TOC" })) }),
      async run(args) {
        const sid = args.source_id ? String(args.source_id) : "";
        if (!sid) return tocText();
        const ns = bySource.get(sid) ?? [];
        if (ns.length === 0) return `no nodes for source ${JSON.stringify(sid)}`;
        return ns.map(tocLine).join("\n");
      },
    },
    {
      name: "read_nodes",
      description: `Read full detail (summary + representative facts) for up to ${READ_BATCH} node ids — the evidence you judge connections on.`,
      parameters: Type.Object({ ids: Type.Array(Type.String(), { maxItems: READ_BATCH }) }),
      async run(args) {
        const ids = (Array.isArray(args.ids) ? args.ids.map(String) : []).slice(0, READ_BATCH);
        if (ids.length === 0) return "ERROR: pass at least one id";
        return JSON.stringify(ids.map((id) => {
          const n = byId.get(id);
          return n ? { id, title: n.title, source: n.source, summary: n.summary, facts: n.facts } : { id, error: "unknown id" };
        }));
      },
    },
    {
      name: "propose_edge",
      description: `Record a cross-source relationship between two REAL node ids. kind ∈ ${EDGE_KINDS.join("|")}. Distinct ids; at least one should be new. Code sets fidelity to 'guessed'.`,
      parameters: Type.Object({
        from: Type.String(), to: Type.String(),
        kind: Type.String({ description: EDGE_KINDS.join("|") }),
        label: Type.Optional(Type.String()),
      }),
      async run(args) {
        const from = String(args.from), to = String(args.to), kind = String(args.kind);
        if (!byId.has(from) || !byId.has(to) || from === to) return "rejected: from/to must be two distinct real node ids";
        if (!(EDGE_KINDS as readonly string[]).includes(kind)) return `rejected: kind must be one of ${EDGE_KINDS.join("|")}`;
        decision.induced_edges.push({ from, to, kind, ...(args.label ? { label: String(args.label) } : {}) });
        return "recorded";
      },
    },
    {
      name: "propose_merge",
      description: "Fold a duplicate view into another (they are the same screen/state seen in two sources).",
      parameters: Type.Object({ from_view: Type.String(), into_view: Type.String() }),
      async run(args) {
        const from = String(args.from_view), into = String(args.into_view);
        if (!validViews.has(from) || !validViews.has(into) || from === into) return "rejected: unknown or identical view ids";
        decision.view_merges.push({ from, into });
        return "recorded";
      },
    },
    {
      name: "mark_orphan",
      description: "Record a node you genuinely cannot connect to anything — a knowledge gap, not a forced edge.",
      parameters: Type.Object({ node_id: Type.String(), reason: Type.String() }),
      async run(args) {
        const id = String(args.node_id);
        if (!byId.has(id)) return "rejected: unknown node id";
        decision.orphans.push({ node_id: id, reason: String(args.reason ?? "unconnectable") });
        return "recorded";
      },
    },
  ];

  // Open WITH the table of contents (global awareness up front — the whole point),
  // plus the goals for context. Detail is loaded lazily from here.
  const user =
    `${tocText()}\n\n` +
    `Brief goals (for context only):\n${JSON.stringify(input.goals)}\n\n` +
    "Scan the table of contents, find nodes across sources that connect, read detail on candidates, and propose the connections.";

  await gateway.extractWithTools!({
    label: "link",
    system: SYSTEM,
    user,
    schema: v.object({ done: v.optional(v.boolean()) }), // decisions arrive via tools; this is ignored
    tools,
    maxSteps: stepBudget(input.nodes.length),
    ...(stage.model ? { model: stage.model } : {}),
    ...(stage.thinking ? { reasoning: stage.thinking } : {}),
  });

  return decision;
}
