// Deterministic surface-form similarity for entity resolution (spec 04). Shared by
// the `resolve` stage (which computes the merge confidence, code-owned) and the
// deterministic gateway (which stands in for the model's same/different judgment),
// so the two never drift. The real gateway uses the model instead; this is only the
// reproducible harness.

const STOP = new Set(["the", "and", "of", "for", "a", "an"]);

/** Meaningful tokens: lowercase alphanumeric, length > 1, minus stopwords. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Token-joined normal form (stable, punctuation/stopword-insensitive). */
export function normalize(s: string): string {
  return tokens(s).join(" ");
}

/** Similarity of two surface forms in [0, 1]: exact normal-form match = 1, a
 *  substring (abbreviation/qualifier, "Caterpillar Inc." ⊃ "Caterpillar") = 0.9,
 *  else the token overlap coefficient (|A∩B| / min(|A|, |B|)). */
export function surfaceSim(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const min = Math.min(ta.size, tb.size);
  return min ? inter / min : 0;
}

/** Best similarity across the cross product of two entities' surface forms
 *  (label + aliases). This is the code-owned merge confidence (spec 04 §2). */
export function similarity(surfacesA: string[], surfacesB: string[]): number {
  let best = 0;
  for (const a of surfacesA) for (const b of surfacesB) best = Math.max(best, surfaceSim(a, b));
  return best;
}
