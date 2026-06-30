// Shared, deterministic helpers for the offline Resolvers.

import type { GraphNode } from "./types.ts";

const STOPWORDS = new Set(["the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "your", "you", "is", "are", "it", "this", "that", "with", "by", "at"]);

export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** A node's originating source (its first receipt's source_id). */
export function sourceOf(n: GraphNode): string | undefined {
  return (n.source_refs as Array<{ source_id?: string }>)[0]?.source_id;
}
