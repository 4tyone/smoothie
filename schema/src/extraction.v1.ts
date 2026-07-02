// @smoothie/schema - smoothie.extraction.v1: the processor output contract.
//
// A processor (any executable, any language) that runs in `direct`/`extract` mode
// prints ONE of these to stdout; it is also the shape the `describe` agent produces
// after navigating a source. The pipeline's homogeneous form is the `fact` - this
// envelope carries facts a processor PROPOSES, minus the fields code always owns
// (`fact_id`, `source_refs`, `brief_id`), which are materialized by Smoothie so a
// third-party processor can never forge a receipt (spec 10 - trust floor).
//
// Frozen alongside bc.v1: additive-optional fields are allowed within v1; a breaking
// change bumps `smoothie.extraction.v2`.

export const EXTRACTION_VERSION = "smoothie.extraction.v1" as const;

/** A source span the processor proposes; code binds it to the real source_id. */
export type ExtractionSpan =
  | { kind: "time"; t_start: number; t_end: number }
  | { kind: "doc"; page?: number; section?: string; lines?: [number, number]; label?: string };

/** A drafted web-app action (claimed fidelity; locators are described, not resolved). */
export type ExtractionActionDraft = {
  verb: "goto" | "click" | "fill" | "select" | "press" | "scroll" | "wait_for" | "unknown";
  target: string;
  value_hint?: string;
  locator_hint?: string;
  expected_effect?: string;
};

/** One proposed fact. `locator` is a human citation of WHERE it came from; `span` is
 *  its structured form. Either or both may be given; code prefers `span`, else turns
 *  `locator` into a `doc` span label. */
export type ExtractionFact = {
  kind: "knowledge" | "action";
  text: string;
  confidence: number; // 0..1
  fidelity: "claimed" | "guessed";
  locator?: string;
  span?: ExtractionSpan;
  view_id?: string;
  action_draft?: ExtractionActionDraft;
};

/** A companion artifact the processor wrote (path relative to the source workdir). */
export type ExtractionCompanion = {
  kind: "transcript" | "frame" | "screenshot" | "dom" | "ax" | "audio" | "other";
  path: string;
};

/** The document a processor prints to stdout (or the agent produces). */
export type ExtractionEnvelope = {
  envelope: typeof EXTRACTION_VERSION;
  facts: ExtractionFact[];
  companions?: ExtractionCompanion[];
  diagnostics?: string[];
};

/** A processor's self-description: the commands the agent may drive (spec 10). A
 *  package prints this from a `manifest` command, or ships it as `manifest.json`. */
export type ProcessorManifest = {
  manifest: "smoothie.processor.v1";
  name: string;
  version?: string;
  /** How the agent reads it, if it wants a text projection first. */
  description?: string;
  commands: Array<{
    name: string;
    /** What this command does / when to use it - shown to the agent. */
    description?: string;
    /** The shell template, e.g. `bin/read --page $page`. `$SMOOTHIE_*` + params interpolate. */
    run: string;
    params?: Record<string, { type?: string; default?: unknown; description?: string }>;
    /** `text` (render/query, the agent reads it) or `extract` (prints an envelope). */
    emits?: "text" | "extract";
  }>;
};
