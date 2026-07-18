// Producer-side extraction valibot shapes — what the `describe` stage emits, mirroring
// the shared `extraction.v1` envelope (spec 02 · Facts, spec 10 · processors). Pi's
// structured-output call validates the model's output against these, so a malformed
// extraction is rejected before it ever reaches the ontology.
//
// These cover only the extraction layer (facts, receipts, the processor envelope) and
// the resolve judge — the typed ontology shapes live in `../ontology/schemas.ts`.

import * as v from "valibot";

export const Fidelity = v.picklist(["claimed", "guessed", "absent"]);
export const FactKind = v.picklist(["knowledge", "action"]);
export const Verb = v.picklist([
  "goto", "click", "fill", "select", "press", "scroll", "wait_for", "unknown",
]);

/** A documentary source span (producer emits `doc` for text, `time` for A/V). */
export const SourceSpan = v.variant("kind", [
  v.object({ kind: v.literal("doc"), page: v.optional(v.number()), section: v.optional(v.string()), label: v.optional(v.string()) }),
  v.object({ kind: v.literal("time"), t_start: v.number(), t_end: v.number() }),
]);

export const SourceRef = v.object({
  source_id: v.string(),
  span: SourceSpan,
});

export const ActionDraft = v.object({
  verb: Verb,
  target: v.string(),
  value_hint: v.optional(v.string()),
  locator_hint: v.optional(v.string()),
  expected_effect: v.optional(v.string()),
});

// The canonical Fact shape — STRICT. Used by the processor `extract` envelope
// (spec 10: an invalid envelope is a hard error, fail-closed). The model-facing
// describe path uses the tolerant `ProposedFact` below instead.
export const Fact = v.object({
  fact_id: v.optional(v.string()),
  kind: FactKind,
  text: v.string(),
  confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  view_id: v.optional(v.string()),
  fidelity: Fidelity,
  locator: v.optional(v.string()),
  span: v.optional(SourceSpan),
  action_draft: v.optional(ActionDraft),
});
export type Fact = v.InferOutput<typeof Fact>;

// ── The model-facing proposal shapes — TOLERANT ──
// The model proposes; code owns the contract. A field it gets slightly wrong must
// NOT reject the whole source's extraction; each field falls back to a safe default,
// and the materialized output is validated against the strict contract downstream.
export const ProposedActionDraft = v.object({
  verb: v.fallback(Verb, "unknown"),
  target: v.string(),
  value_hint: v.optional(v.string()),
  locator_hint: v.optional(v.string()),
  expected_effect: v.optional(v.string()),
});
export const ProposedFact = v.object({
  fact_id: v.optional(v.string()),
  kind: v.fallback(FactKind, "knowledge"),
  text: v.string(),
  confidence: v.fallback(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.5),
  view_id: v.optional(v.string()),
  fidelity: v.fallback(Fidelity, "claimed"),
  locator: v.optional(v.string()),
  span: v.optional(SourceSpan),
  action_draft: v.optional(ProposedActionDraft),
});

/** What `describe` asks the model to return for one source (tolerant proposals). */
export const DescribeResult = v.object({
  facts: v.array(ProposedFact),
});
export type DescribeResult = v.InferOutput<typeof DescribeResult>;

/** `smoothie.extraction.v1` — the processor output contract (spec 10). A processor
 *  running in `direct`/`extract` mode prints this to stdout; code validates it, then
 *  materializes provenance so a processor can never forge a receipt. Mirrors
 *  `schema/extraction.v1.schema.json`. */
export const CompanionKind = v.picklist(["transcript", "frame", "screenshot", "dom", "ax", "audio", "other"]);
export const ExtractionCompanion = v.object({ kind: CompanionKind, path: v.string() });
export const ExtractionEnvelope = v.object({
  envelope: v.literal("smoothie.extraction.v1"),
  facts: v.array(Fact),
  companions: v.optional(v.array(ExtractionCompanion)),
  diagnostics: v.optional(v.array(v.string())),
});
export type ExtractionEnvelope = v.InferOutput<typeof ExtractionEnvelope>;

/** A single yes/no semantic judgment (spec 04 · resolve) — "are these the same
 *  entity?". The MODEL decides; a resolver never guesses sameness from token overlap
 *  alone. */
export const JudgeResult = v.object({ yes: v.fallback(v.boolean(), false) });
export type JudgeResult = v.InferOutput<typeof JudgeResult>;
