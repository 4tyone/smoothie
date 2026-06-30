// Re-examine Resolver (spec 08) — ground truth = the raw bytes. Re-reads the
// original source material the node's receipt points to and confirms the claim
// only when the source genuinely supports it — catching describe-stage overreach
// without any external system. Deterministic (token coverage of the source text).

import type { Resolver, GraphNode, Resolution, ResolveContext } from "./types.ts";
import { tokens, sourceOf } from "./util.ts";

const COVERAGE_THRESHOLD = 0.7;

export const reExamineResolver: Resolver = {
  name: "re-examine",
  profile: "*",
  groundTruth: "raw",

  resolve(node: GraphNode, ctx: ResolveContext): Resolution {
    // A doc re-read confirms the claim was *stated*, not that a web-app locator
    // works — so web-app executable nodes still need the live crawler (spec 08).
    if (ctx.profile === "web-app") return { status: "unresolved", reason: "web-app confirmation requires the live DOM" };

    const src = sourceOf(node);
    const text = src ? ctx.sourceText?.(src) : undefined;
    if (!src || !text) return { status: "unresolved", reason: "source bytes unavailable" };

    const need = tokens(node.title);
    if (need.size === 0) return { status: "unresolved", reason: "no comparable claim" };
    const haystack = text.toLowerCase();
    let hit = 0;
    for (const t of need) if (haystack.includes(t)) hit++;

    if (hit / need.size >= COVERAGE_THRESHOLD) {
      return {
        status: "confirmed",
        receipt: { source_id: src, span: { kind: "resolve", resolver: "re-examine", ref: src, note: "claim supported by the source bytes" } },
        checks: [{ kind: "text_matches", expected: node.title }],
      };
    }
    return { status: "unresolved", reason: "claim not clearly supported by the source bytes" };
  },
};
