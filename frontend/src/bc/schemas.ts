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
export const EdgeKind = v.picklist([
  "contains", "transition", "enables", "depends_on", "next", "related_to",
]);
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
export const Fact = v.object({
  fact_id: v.optional(v.string()),
  kind: FactKind,
  text: v.string(),
  confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  view_id: v.optional(v.string()),
  fidelity: Fidelity,
  locator: v.optional(v.string()),
  action_draft: v.optional(ActionDraft),
});
export type Fact = v.InferOutput<typeof Fact>;

/** What `describe` asks the model to return for one source. */
export const DescribeResult = v.object({
  facts: v.array(Fact),
});
export type DescribeResult = v.InferOutput<typeof DescribeResult>;

// ── structure: the local object (nodes/views/edges/outlines) ──

export const LocatorStrategy = v.object({ by: LocatorBy, value: v.string(), name: v.optional(v.string()) });
export const Locator = v.object({
  description: v.string(),
  primary: LocatorStrategy,
  fallbacks: v.optional(v.array(LocatorStrategy)),
});

export const NodeDraft = v.object({
  id: v.string(),
  title: v.string(),
  summary: v.nullable(v.string()),
  kind: NodeKind,
  view_id: v.optional(v.string()),
  fact_ids: v.array(v.string()),
  /** web-app payload (optional; claimed-fidelity locators are described, not resolved). */
  action: v.optional(v.object({
    kind: Verb,
    url: v.optional(v.string()),
    key: v.optional(v.string()),
    value: v.optional(v.string()),
    locator: v.optional(Locator),
  })),
  checks: v.optional(v.array(v.object({
    kind: v.picklist(["visible", "exists", "text_matches", "url_matches"]),
    expected: v.optional(v.string()),
    locator: v.optional(Locator),
  }))),
  done_when: v.optional(v.string()),
  fidelity: Fidelity,
});

export const EdgeDraft = v.object({
  from: v.string(),
  to: v.string(),
  kind: EdgeKind,
  label: v.optional(v.string()),
  fidelity: Fidelity,
});

export const ViewDraft = v.object({
  view_id: v.string(),
  title: v.string(),
  url_patterns: v.optional(v.array(v.string())),
  node_ids: v.array(v.string()),
  fidelity: Fidelity,
});

export const SceneDraft = v.object({
  scene_id: v.string(),
  title: v.string(),
  node_ids: v.array(v.string()),
  done_when: v.optional(v.string()),
  fidelity: Fidelity,
  gaps: v.optional(v.array(v.string())),
});

export const OutlineDraft = v.object({
  outline_id: v.string(),
  brief_id: v.string(),
  title: v.string(),
  scenes: v.array(SceneDraft),
  fidelity: Fidelity,
});

/** What `structure` asks the model to return for ONE source's facts — a *local*
 *  object (spec 03 · structure). Outlines are reconciled at `link` (over the full
 *  merged graph), so they are not part of the per-source structure contract. */
export const StructureResult = v.object({
  nodes: v.array(NodeDraft),
  views: v.array(ViewDraft),
  edges: v.array(EdgeDraft),
  /** `gap:*` notes discovered while structuring this source. */
  gaps: v.optional(v.array(v.object({ key: v.string(), kind: v.optional(v.string()), text: v.string() }))),
});
export type StructureResult = v.InferOutput<typeof StructureResult>;

/** Batched structure (spec 03 · structure): one model call structures EVERY new
 *  source at once — fewer round-trips, leverages the context window. Each `local`
 *  is the same per-source object as {@link StructureResult}, tagged by `source_id`. */
export const StructureBatchResult = v.object({
  locals: v.array(v.object({
    source_id: v.string(),
    nodes: v.array(NodeDraft),
    views: v.array(ViewDraft),
    edges: v.array(EdgeDraft),
    gaps: v.optional(v.array(v.object({ key: v.string(), kind: v.optional(v.string()), text: v.string() }))),
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
