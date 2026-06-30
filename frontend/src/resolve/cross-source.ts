// Cross-source Resolver (spec 08) — ground truth = independent corroboration.
// Confirms a node when an INDEPENDENT source asserts the same thing (a step shown
// in a video *and* written in a PDF). Cheap, needs no live target, applies to
// every profile, and is fully **deterministic** (token-overlap similarity) — so
// it verifies in CI without a model or a network.

import type { Resolver, GraphNode, Resolution, ResolveContext } from "./types.ts";
import { tokens, jaccard, sourceOf } from "./util.ts";

const SIMILARITY_THRESHOLD = 0.5;

export const crossSourceResolver: Resolver = {
  name: "cross-source",
  profile: "*",
  groundTruth: "cross-source",

  resolve(node: GraphNode, ctx: ResolveContext): Resolution {
    // For the web-app profile the authoritative ground truth is the LIVE DOM
    // (the crawler), not another document — so corroboration only strengthens
    // confidence; it never confirms an executable node here (spec 08). Stays
    // `claimed` until the live crawler runs.
    if (ctx.profile === "web-app") return { status: "unresolved", reason: "web-app confirmation requires the live DOM" };

    const mySource = sourceOf(node);
    const myTokens = tokens(node.title);
    if (!mySource || myTokens.size === 0) {
      return { status: "unresolved", reason: "no comparable title/source" };
    }

    // Find an independent (different-source) node asserting the same thing.
    for (const other of ctx.nodes) {
      if (other.id === node.id) continue;
      const otherSource = sourceOf(other);
      if (!otherSource || otherSource === mySource) continue; // must be INDEPENDENT
      if (jaccard(myTokens, tokens(other.title)) >= SIMILARITY_THRESHOLD) {
        return {
          status: "confirmed",
          receipt: {
            source_id: otherSource,
            span: { kind: "resolve", resolver: "cross-source", ref: other.id, note: `corroborated by ${otherSource}` },
          },
          // The evaluated oracle: the claim text matched across sources.
          checks: [{ kind: "text_matches", expected: node.title }],
        };
      }
    }
    return { status: "unresolved", reason: "no independent corroboration" };
  },
};
