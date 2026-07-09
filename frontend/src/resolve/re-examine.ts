// Re-examine Resolver (spec 08) — ground truth = the raw bytes. Re-reads the
// original source material the node's receipt points to and confirms the claim
// only when the source genuinely supports it — catching describe-stage overreach
// without any external system.
//
// The DECISION is the model's: it reads the claim against the source text and judges
// support. No token-coverage heuristic. Without a judge (gateway), it stays
// `unresolved` rather than confirm on a guess.

import type { Resolver, GraphNode, Resolution, ResolveContext } from "./types.ts";
import { sourceOf } from "./util.ts";

// Cap the source excerpt fed to the model so the judgment stays bounded.
const MAX_EVIDENCE_CHARS = 12000;

const SUPPORT_INSTRUCTION =
  "Decide whether the SOURCE TEXT genuinely supports the CLAIM (the claim is directly " +
  "stated or clearly entailed) — not merely that some words appear. Return JSON " +
  "{ \"yes\": boolean }. yes ONLY if the source really backs the claim.";

export const reExamineResolver: Resolver = {
  name: "re-examine",
  profile: "*",
  groundTruth: "raw",

  async resolve(node: GraphNode, ctx: ResolveContext): Promise<Resolution> {
    // A doc re-read confirms the claim was *stated*, not that a web-app locator
    // works — web-app executable nodes still need the live crawler (spec 08).
    if (ctx.profile === "web-app") return { status: "unresolved", reason: "web-app confirmation requires the live DOM" };
    if (!ctx.judge) return { status: "unresolved", reason: "no model available to judge support" };

    const src = sourceOf(node);
    const text = src ? ctx.sourceText?.(src) : undefined;
    if (!src || !text) return { status: "unresolved", reason: "source bytes unavailable" };

    const supported = await ctx.judge(
      SUPPORT_INSTRUCTION,
      JSON.stringify({ claim: claimOf(node), source_text: text.slice(0, MAX_EVIDENCE_CHARS) }),
    );
    if (supported) {
      return {
        status: "confirmed",
        receipt: { source_id: src, span: { kind: "resolve", resolver: "re-examine", ref: src, note: "claim supported by the source bytes" } },
        checks: [{ kind: "text_matches", expected: node.title }],
      };
    }
    return { status: "unresolved", reason: "claim not clearly supported by the source bytes" };
  },
};

function claimOf(n: GraphNode): string {
  const summary = (n as { summary?: string }).summary;
  return summary ? `${n.title} — ${summary}` : n.title;
}
