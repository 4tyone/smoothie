// The model gateway — the seam between the deterministic pipeline and the
// non-deterministic model (spec 01 · agentic→deterministic; 07 · model).
//
// The interpretive stages (`describe`, `structure`, `link`) call a `ModelGateway`.
// Two implementations exist side by side:
//   - `RealModelGateway` — the real path on Pi (`gpt-5.5` via a ChatGPT
//     subscription or an API key; ADR-0002).
//   - `DeterministicModelGateway` — a model-free CI determinism harness, so the
//     full producer→contract→consumer thread is reproducible.
//
// Same input → same BC is a hard requirement (spec 03 · compile determinism), so
// the gateway interface is request/response with no hidden state.

import type { GenericSchema, InferOutput } from "valibot";

/** A request to extract typed, structured data from text (+ optional images). */
export interface ExtractRequest<S extends GenericSchema> {
  /** A stable label for telemetry/fixtures, e.g. `describe:markdown`. */
  readonly label: string;
  /** The instruction for the model (the stage's skill prompt). */
  readonly instruction: string;
  /** The extracted source content the model reasons over. */
  readonly content: string;
  /** The Valibot schema the result must satisfy (Pi structured output). */
  readonly schema: S;
  /** Optional images for vision (`describe` of a video frame, etc.). */
  readonly images?: ReadonlyArray<{ data: string; mimeType: string }>;
  /** Per-stage model override, e.g. `openai/gpt-5.5`. */
  readonly model?: string;
  /** Per-stage reasoning effort (Pi `ThinkingLevel`: "minimal"|"low"|"medium"|
   *  "high"). Cross-graph synthesis (link) asks for more; default "low". Honored
   *  by the real gateway; the deterministic one ignores it. */
  readonly reasoning?: string;
}

/** A tool the agent may call during an agentic extraction (e.g. `run_python`). */
export interface AgentTool {
  name: string;
  description: string;
  /** Typebox schema (pi-ai's tool param format). */
  parameters: unknown;
  /** Execute the tool; return the text result the model sees. */
  run(args: Record<string, unknown>): Promise<string>;
}

/** An agentic extraction: the model explores with `tools` (writing + running
 *  Python), then returns structured data validated against `schema`. */
export interface AgentExtractRequest<S extends GenericSchema> {
  readonly label: string;
  /** System prompt — the stage instruction plus the per-modality skill. */
  readonly system: string;
  /** The task for the agent (the source to process). */
  readonly user: string;
  readonly schema: S;
  readonly tools: AgentTool[];
  readonly maxSteps?: number;
  /** Per-stage model override (e.g. `openai-codex/gpt-5.5`). */
  readonly model?: string;
  /** Per-stage reasoning effort (Pi `ThinkingLevel`); default is the agent default. */
  readonly reasoning?: string;
}

/** The model gateway both stages depend on. */
export interface ModelGateway {
  /** `real` = a real model (the default); `stub` = the CI determinism harness. */
  readonly kind: "real" | "stub";
  extract<S extends GenericSchema>(req: ExtractRequest<S>): Promise<InferOutput<S>>;
  /** Agentic extraction with tools — only the real gateway supports it; the
   *  deterministic harness leaves it undefined (CI uses the built-in readers). */
  extractWithTools?<S extends GenericSchema>(req: AgentExtractRequest<S>): Promise<InferOutput<S>>;
}
