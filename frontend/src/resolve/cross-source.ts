// Cross-source Resolver (spec 08) — ground truth = independent corroboration.
// Confirms a node when an INDEPENDENT source genuinely asserts the same thing (a
// step shown in a video *and* written in a PDF).
//
// The DECISION is the model's, not token overlap: a cheap lexical filter only
// narrows the candidate set (recall — avoids an O(n²) model sweep), then the model
// JUDGES whether each candidate truly corroborates. If no judge (gateway) is wired,
// it stays `unresolved` rather than confirm on a guess.

import type { Resolver, GraphNode, Resolution, ResolveContext } from "./types.ts";
import { tokens, jaccard, sourceOf } from "./util.ts";

// Lexical RECALL filter only — a low bar to find candidates worth a model judgment.
// It never confirms anything; the model does.
const RECALL_THRESHOLD = 0.2;
const MAX_CANDIDATES = 4; // bound model calls per node

const CORROBORATE_INSTRUCTION =
  "Two statements come from DIFFERENT independent sources. Answer whether they assert " +
  "the SAME underlying fact (one corroborates the other) — judge by MEANING, not shared " +
  "words. Return JSON { \"yes\": boolean }. yes ONLY if they genuinely state the same thing.";

export const crossSourceResolver: Resolver = {
  name: "cross-source",
  profile: "*",
  groundTruth: "cross-source",

  async resolve(node: GraphNode, ctx: ResolveContext): Promise<Resolution> {
    // Web-app authoritative ground truth is the LIVE DOM (the crawler), not another
    // document — corroboration never confirms an executable node here (spec 08).
    if (ctx.profile === "web-app") return { status: "unresolved", reason: "web-app confirmation requires the live DOM" };
    if (!ctx.judge) return { status: "unresolved", reason: "no model available to judge corroboration" };

    const mySource = sourceOf(node);
    const myTokens = tokens(node.title);
    if (!mySource || myTokens.size === 0) return { status: "unresolved", reason: "no comparable title/source" };

    // Recall: independent-source nodes with SOME lexical overlap, best first, bounded.
    const candidates = ctx.nodes
      .filter((o) => o.id !== node.id)
      .map((o) => ({ o, src: sourceOf(o), score: jaccard(myTokens, tokens(o.title)) }))
      .filter((c) => c.src && c.src !== mySource && c.score >= RECALL_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);

    // Decision: the MODEL judges genuine corroboration.
    for (const c of candidates) {
      const same = await ctx.judge(
        CORROBORATE_INSTRUCTION,
        JSON.stringify({ a: claimOf(node), b: claimOf(c.o) }),
      );
      if (same) {
        return {
          status: "confirmed",
          receipt: {
            source_id: c.src!,
            span: { kind: "resolve", resolver: "cross-source", ref: c.o.id, note: `corroborated by ${c.src}` },
          },
          checks: [{ kind: "text_matches", expected: node.title }],
        };
      }
    }
    return { status: "unresolved", reason: "no independent corroboration" };
  },
};

/** The node's claim as the model sees it — title plus summary when present. */
function claimOf(n: GraphNode): string {
  const summary = (n as { summary?: string }).summary;
  return summary ? `${n.title} — ${summary}` : n.title;
}
