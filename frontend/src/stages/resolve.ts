// resolve (agent + Resolver) — the accuracy stage, pluggable & optional (spec 03;
// 08). A Resolver verifies a node against ground truth and promotes fidelity
// `claimed`/`guessed` → `confirmed`, **in place** — only the affected nodes
// change; everything else is untouched (the re-entry / promote-in-place thesis).
//
// No Resolver requested → a **no-op** and the BC stays honest at `claimed`/
// `guessed` (spec 08 · v1 default). Confirmation always carries a real resolution
// receipt + evaluated checks (the SVM's compile gate enforces it).

import type { MergedGraph } from "./link.ts";
import * as v from "valibot";
import { selectResolvers } from "../resolve/registry.ts";
import { isConfirmed, type GraphNode, type ResolveContext } from "../resolve/types.ts";
import type { ModelGateway } from "../model/gateway.ts";
import { JudgeResult } from "../bc/schemas.ts";

export interface ResolveResult {
  merged: MergedGraph;
  /** Nodes promoted to `confirmed` this run. */
  promoted: number;
  /** Resolver names that ran. */
  resolvers: string[];
}

export interface ResolveOptions {
  profile: string;
  /** Resolver names to run (from `brief.verify.resolvers` / `--resolve`). */
  requested: string[];
  /** Re-read a source's original text (for the re-examine Resolver). */
  sourceText?: (sourceId: string) => string | undefined;
  /** The model gateway — a Resolver's corroboration/support judgment is the
   *  model's, not lexical token overlap. */
  gateway?: ModelGateway;
}

export async function resolve(merged: MergedGraph, opts: ResolveOptions): Promise<ResolveResult> {
  const resolvers = selectResolvers(opts.profile, opts.requested);
  if (resolvers.length === 0) {
    return { merged, promoted: 0, resolvers: [] }; // no Resolver → honest no-op
  }

  const nodes = merged.nodes as GraphNode[];
  // A model-backed yes/no judgment: this is where corroboration/support is DECIDED
  // (semantically), replacing the resolvers' old token-overlap heuristic.
  const gateway = opts.gateway;
  const judge = gateway
    ? async (instruction: string, content: string): Promise<boolean> => {
        try {
          const r = await gateway.extract({ label: "judge", instruction, content, schema: JudgeResult });
          return (r as v.InferOutput<typeof JudgeResult>).yes === true;
        } catch {
          return false; // a failed judgment never confirms
        }
      }
    : undefined;
  const ctx: ResolveContext = { profile: opts.profile, nodes, sourceText: opts.sourceText, judge };
  let promoted = 0;

  for (const node of nodes) {
    if (isConfirmed(node)) continue; // already confirmed → not re-resolved (spec 08)
    // Cheapest Resolver first; the first `confirmed` wins.
    for (const resolver of resolvers) {
      const res = await resolver.resolve(node, ctx);
      if (res.status !== "confirmed") continue;
      // Promote IN PLACE: set fidelity, append the receipt + evaluated checks.
      node.fidelity = "confirmed";
      (node.source_refs as unknown[]).push(res.receipt);
      const checks = (node.checks as unknown[] | undefined) ?? [];
      node.checks = [...checks, ...res.checks];
      promoted++;
      break;
    }
  }

  return { merged, promoted, resolvers: resolvers.map((r) => r.name) };
}
