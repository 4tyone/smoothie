// Generic, deterministic name normalization for consolidating the model-coined type
// and relation vocabularies (spec 03/04). The model tends to mint a bespoke type or
// predicate per sentence ("affects", "affected_by", "affects_reported_sales";
// "application_of", "application_within_segment"), which sprawls the schema. This
// folds inflection, word order, and function words so near-duplicate names collapse
// to one canonical form.
//
// STRICTLY domain-agnostic: no hardcoded names, no scenario-specific rules — only
// English morphology. Two names with the SAME signature denote the same type/relation
// up to plural/tense, ordering, and stopwords. `by` is deliberately kept (it marks
// passive/inverse relations, which must NOT merge with their active form).

const STOPWORDS = new Set([
  "of", "for", "with", "within", "to", "from", "the", "a", "an", "in", "on", "at",
  "and", "or", "as", "into", "per", "its", "their", "that", "this", "other", "between",
]);

/** Light inflectional stemmer — plural/tense only, with length guards so short tokens
 *  (has, use, is) are never mangled. Biased toward UNDER-merging: it collapses obvious
 *  inflections (affect/affects/affected/affecting, report/reports/reported/reporting)
 *  but leaves distinct roots apart. Deterministic; the exact stem need not be a real
 *  word, only stable. */
export function stem(tok: string): string {
  const t = tok;
  if (t.length <= 4) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y"; // companies -> company
  if (t.endsWith("sses")) return t.slice(0, -2); // addresses -> address
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3); // reporting -> report
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2); // affected -> affect
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1); // affects -> affect
  return t;
}

/** The order-independent, inflection-folded signature of a name. Names with equal
 *  signatures are treated as the same type/relation. */
export function nameSignature(name: string): string {
  const toks = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem)
    .filter(Boolean);
  return [...new Set(toks)].sort().join(" ");
}

/** Build a canonical-name map over a multiset of surface names. Names sharing a
 *  signature collapse to ONE canonical surface form, chosen deterministically: the
 *  most frequent, then the shortest, then lexicographically first. Domain-agnostic —
 *  the winner is whichever surface the corpus used most, never a hardcoded label. */
export function canonicalizeNames(names: Iterable<string>): Map<string, string> {
  const freq = new Map<string, number>();
  for (const n of names) freq.set(n, (freq.get(n) ?? 0) + 1);

  const bySig = new Map<string, string[]>();
  for (const n of freq.keys()) {
    const sig = nameSignature(n);
    if (!sig) continue; // an all-stopword name has no signature — leave it untouched
    const arr = bySig.get(sig) ?? [];
    arr.push(n);
    bySig.set(sig, arr);
  }

  const canon = new Map<string, string>();
  for (const group of bySig.values()) {
    const winner = group.slice().sort((a, b) => {
      const fa = freq.get(a)!;
      const fb = freq.get(b)!;
      if (fa !== fb) return fb - fa; // most frequent
      if (a.length !== b.length) return a.length - b.length; // then shortest
      return a < b ? -1 : 1; // then lexicographic
    })[0];
    for (const n of group) canon.set(n, winner);
  }
  return canon;
}
