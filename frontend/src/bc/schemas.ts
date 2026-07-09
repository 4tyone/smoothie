// Producer-side Valibot schemas — the shapes the `describe` and `structure`
// stages emit, mirroring `bc.v1` (spec 02). Pi's structured-output call
// validates the model's output against these, so a malformed extraction is
// rejected before it ever reaches the graph.
//
// These deliberately cover only what the producer emits at `claimed`/`guessed`
// fidelity (no Resolver in v1, spec 08): documentary spans, no `confirmed`.

import * as v from "valibot";

export const Fidelity = v.picklist(["claimed", "guessed", "absent"]);
export const FactKind = v.picklist(["knowledge", "action"]);
export const Verb = v.picklist([
  "goto", "click", "fill", "select", "press", "scroll", "wait_for", "unknown",
]);
export const NodeKind = v.picklist(["screen", "feature", "flow", "action", "topic"]);
export const EDGE_KINDS = ["contains", "transition", "enables", "depends_on", "next", "related_to"] as const;
export const EdgeKind = v.picklist(EDGE_KINDS);
export const LocatorBy = v.picklist(["role", "testid", "label", "text", "css"]);

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

/** The single canonical Fact shape (spec 02 · Facts). `fact_id` is assigned by
 *  the describe stage (code), so the model may omit it. `locator` is the agent's
 *  citation of WHERE in the source the fact came from (e.g. "page 3",
 *  "Sheet 'Sales'") — it becomes the fact's provenance span. */
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
  /** Structured form of the citation (spec 10). Code prefers this over `locator`
   *  when materializing the provenance span; A/V processors emit `time` here. */
  span: v.optional(SourceSpan),
  action_draft: v.optional(ActionDraft),
});
export type Fact = v.InferOutput<typeof Fact>;

// ── The model-facing proposal shapes — TOLERANT ──
// The model proposes; code owns the contract. A field it gets slightly wrong (a
// verb synonym like "visit", an off-enum kind, a confidence it overshoots) must
// NOT reject the whole source's extraction — which fail-fast would escalate into
// an aborted multi-source compile (the cat_case_study run died 63/82 over one
// "visit"). Each field falls back to a safe default; the materialized output is
// still validated against the strict bc.v1 contract by `svm validate` on read.
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
 *  materializes provenance (`fact_id`/`source_refs`/`brief_id`) so a processor can
 *  never forge a receipt. Mirrors `schema/extraction.v1.schema.json`. */
// Mirror the JSON Schema exactly: a fixed `kind` enum, so an off-contract
// companion is rejected here (fail-closed) instead of surviving the loose valibot
// check and dying later at `svm validate`.
export const CompanionKind = v.picklist(["transcript", "frame", "screenshot", "dom", "ax", "audio", "other"]);
export const ExtractionCompanion = v.object({ kind: CompanionKind, path: v.string() });
export const ExtractionEnvelope = v.object({
  envelope: v.literal("smoothie.extraction.v1"),
  facts: v.array(Fact),
  companions: v.optional(v.array(ExtractionCompanion)),
  diagnostics: v.optional(v.array(v.string())),
});
export type ExtractionEnvelope = v.InferOutput<typeof ExtractionEnvelope>;

// ── structure: the local object (nodes/views/edges/outlines) ──

export const LocatorStrategy = v.object({ by: LocatorBy, value: v.string(), name: v.optional(v.string()) });
export const Locator = v.object({
  description: v.string(),
  primary: LocatorStrategy,
  fallbacks: v.optional(v.array(LocatorStrategy)),
});

// The structure DRAFT shapes are model-facing, so they are TOLERANT of the model's
// proposals (like `ProposedFact`): enums fall back rather than reject the whole
// source, and optional objects accept `null` (the model often sends null instead of
// omitting). One off-enum `fidelity: "high"` used to reject an 8-source chunk and
// cascade into slow per-source retries; code owns the contract, `svm validate`
// enforces the strict bc.v1 shape on the materialized output.
export const NodeDraft = v.object({
  id: v.string(),
  title: v.string(),
  summary: v.nullish(v.string()),
  kind: v.fallback(NodeKind, "topic"),
  view_id: v.optional(v.string()),
  fact_ids: v.optional(v.array(v.string()), []),
  /** web-app payload (optional; claimed-fidelity locators are described, not resolved). */
  action: v.nullish(v.object({
    kind: v.fallback(Verb, "unknown"),
    url: v.optional(v.string()),
    key: v.optional(v.string()),
    value: v.optional(v.string()),
    locator: v.optional(Locator),
  })),
  checks: v.nullish(v.array(v.object({
    kind: v.fallback(v.picklist(["visible", "exists", "text_matches", "url_matches"]), "exists"),
    expected: v.optional(v.string()),
    locator: v.optional(Locator),
  }))),
  done_when: v.optional(v.string()),
  fidelity: v.fallback(Fidelity, "claimed"),
  /** Brief goal ids this node serves — the model's SEMANTIC judgment (0+ goals).
   *  `link` groups nodes into each goal's outline by this tag, so scene membership
   *  is a model decision, not a lexical guess. Producer-internal (not a bc.v1 field). */
  goal_ids: v.optional(v.array(v.string())),
});

export const EdgeDraft = v.object({
  from: v.string(),
  to: v.string(),
  kind: v.fallback(EdgeKind, "related_to"),
  label: v.optional(v.string()),
  fidelity: v.fallback(Fidelity, "guessed"),
});

export const ViewDraft = v.object({
  view_id: v.string(),
  title: v.string(),
  url_patterns: v.optional(v.array(v.string())),
  node_ids: v.optional(v.array(v.string()), []),
  fidelity: v.fallback(Fidelity, "claimed"),
});

export const SceneDraft = v.object({
  scene_id: v.string(),
  title: v.string(),
  node_ids: v.optional(v.array(v.string()), []),
  done_when: v.optional(v.string()),
  fidelity: v.fallback(Fidelity, "claimed"),
  gaps: v.optional(v.array(v.string())),
});

export const OutlineDraft = v.object({
  outline_id: v.string(),
  brief_id: v.string(),
  title: v.string(),
  scenes: v.optional(v.array(SceneDraft), []),
  fidelity: v.fallback(Fidelity, "claimed"),
});

/** What `structure` asks the model to return for ONE source's facts — a *local*
 *  object (spec 03 · structure). Outlines are reconciled at `link` (over the full
 *  merged graph), so they are not part of the per-source structure contract. */
// Arrays accept null items and drop them — the model occasionally emits a `null`
// where an object belongs, which used to reject the whole source.
const compactNodes = v.pipe(v.optional(v.array(v.nullable(NodeDraft)), []), v.transform((a) => a.filter((x): x is v.InferOutput<typeof NodeDraft> => x != null)));
const compactViews = v.pipe(v.optional(v.array(v.nullable(ViewDraft)), []), v.transform((a) => a.filter((x): x is v.InferOutput<typeof ViewDraft> => x != null)));
const compactEdges = v.pipe(v.optional(v.array(v.nullable(EdgeDraft)), []), v.transform((a) => a.filter((x): x is v.InferOutput<typeof EdgeDraft> => x != null)));
const StructGaps = v.optional(v.array(v.object({ key: v.string(), kind: v.optional(v.string()), text: v.string() })));

export const StructureResult = v.object({
  nodes: compactNodes,
  views: compactViews,
  edges: compactEdges,
  /** `gap:*` notes discovered while structuring this source. */
  gaps: StructGaps,
});
export type StructureResult = v.InferOutput<typeof StructureResult>;

/** Batched structure (spec 03 · structure): one model call structures EVERY new
 *  source at once — fewer round-trips, leverages the context window. Each `local`
 *  is the same per-source object as {@link StructureResult}, tagged by `source_id`. */
export const StructureBatchResult = v.object({
  locals: v.array(v.object({
    source_id: v.string(),
    nodes: compactNodes,
    views: compactViews,
    edges: compactEdges,
    gaps: StructGaps,
  })),
});
export type StructureBatchResult = v.InferOutput<typeof StructureBatchResult>;

/** What `link` asks the model to return: cross-source connection decisions
 *  (spec 03 · link). The stage applies these in code (merge/induce/orphan). */
export const LinkResult = v.object({
  /** Fold the `from` view into the `into` view (same screen/state, two receipts). */
  view_merges: v.optional(v.array(v.object({ from: v.string(), into: v.string() }))),
  /** Cross-source connections the within-source pass could not see. Emitted at
   *  `guessed` fidelity, citing both endpoints' receipts. */
  induced_edges: v.optional(v.array(v.object({
    from: v.string(), to: v.string(), kind: EdgeKind, label: v.optional(v.string()),
  }))),
  /** Nodes the linker could not connect → recorded as `gap:` notes, not forced edges. */
  orphans: v.optional(v.array(v.object({ node_id: v.string(), reason: v.string() }))),
});
export type LinkResult = v.InferOutput<typeof LinkResult>;

/** A single yes/no semantic judgment (spec 08 · resolvers) — "do these corroborate?"
 *  / "does this text support the claim?" The MODEL decides; a Resolver never guesses
 *  corroboration from token overlap. */
export const JudgeResult = v.object({ yes: v.fallback(v.boolean(), false) });
export type JudgeResult = v.InferOutput<typeof JudgeResult>;
