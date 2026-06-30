// The Smoothie config — the required, structured `smoothie_config.yaml`
// (spec 02 · Brief; 03 · ingest). It carries the **Brief** (the compiler's
// directive input) plus runtime **config**: which model to use and the thinking
// budget for each stage.
//
// It is mandatory and schema-validated. With no valid config the pipeline does
// not run — `ingest` aborts, the way a compiler refuses with no source. `ingest`
// fans the Brief's fields out to the right BC sections; later stages read those
// (and the resolved per-stage settings), never the raw file.

import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import * as v from "valibot";

export const CONFIG_FILENAME = "smoothie_config.yaml";

const Goal = v.object({
  id: v.string(),
  text: v.string(),
  done_when: v.optional(v.string()),
});

const GlossarySeed = v.object({ term: v.string(), definition: v.string() });

const DangerSeed = v.object({
  match: v.string(),
  level: v.picklist(["block", "approve", "supervise"]),
  reason: v.string(),
});

/** Thinking levels Pi accepts (a stage may ask for more/less effort). */
export const ThinkingLevels = ["minimal", "low", "medium", "high"] as const;

/** Per-stage runtime tuning: optional model override + thinking budget. */
const StageConfig = v.object({
  model: v.optional(v.string()),
  thinking: v.optional(v.picklist(ThinkingLevels)),
});

/** The Brief proper — the directive that shapes the compile (spec 02 · Brief). */
const BriefSection = v.object({
  intent: v.pipe(v.string(), v.minLength(1)),
  goals: v.pipe(v.array(Goal), v.minLength(1)),
  scope: v.optional(v.object({
    include: v.optional(v.array(v.string())),
    exclude: v.optional(v.array(v.string())),
    sources: v.optional(v.array(v.object({ path: v.string(), note: v.optional(v.string()) }))),
  })),
  target: v.optional(v.object({
    base_url: v.optional(v.string()),
    allowed_origins: v.optional(v.array(v.string())),
    start_paths: v.optional(v.array(v.string())),
  })),
  verify: v.optional(v.object({
    resolve: v.optional(v.boolean()),
    resolvers: v.optional(v.array(v.string())),
    mode: v.optional(v.picklist(["read-only", "dry-run", "live"])),
    credentials: v.optional(v.string()),
  })),
  policy: v.optional(v.object({
    danger: v.optional(v.array(DangerSeed)),
    budget: v.optional(v.object({
      max_actions: v.optional(v.number()),
      max_pages: v.optional(v.number()),
    })),
  })),
  glossary: v.optional(v.array(GlossarySeed)),
  manifest: v.optional(v.object({
    app_name: v.optional(v.string()),
    author: v.optional(v.string()),
    organization: v.optional(v.string()),
  })),
});

/** The `smoothie_config.yaml` schema (`smoothie.config.v1`). Mirrors the bc.vN
 *  versioning discipline: a breaking change bumps the version in lockstep. */
export const SmoothieConfig = v.object({
  version: v.literal("smoothie.config.v1"),
  profile: v.string(),
  brief: BriefSection,
  /** Global model selection; a stage may override it (see `stages`). */
  model: v.optional(v.object({ default: v.optional(v.string()) })),
  /** Per-stage model + thinking budget. Omitted stages use the defaults below. */
  stages: v.optional(v.object({
    describe: v.optional(StageConfig),
    structure: v.optional(StageConfig),
    link: v.optional(StageConfig),
  })),
});
export type SmoothieConfig = v.InferOutput<typeof SmoothieConfig>;
export type BriefFile = SmoothieConfig; // back-compat alias for existing imports

export class ConfigError extends Error {}

/** Read + validate `smoothie_config.yaml`. Aborts (throws) if missing or invalid. */
export function loadConfig(folder: string): { config: SmoothieConfig; rawPath: string } {
  const rawPath = path.join(folder, CONFIG_FILENAME);
  if (!fs.existsSync(rawPath)) {
    throw new ConfigError(
      `no ${CONFIG_FILENAME} in ${folder} — the Smoothie config is required; ingest cannot run without it (spec 02 · Brief).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(rawPath, "utf8"));
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid YAML: ${(e as Error).message}`);
  }
  const result = v.safeParse(SmoothieConfig, parsed);
  if (!result.success) {
    const issues = result.issues.map((i) => `${i.path?.map((p) => p.key).join(".") ?? "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(`${CONFIG_FILENAME} failed validation: ${issues}`);
  }
  return { config: result.output, rawPath };
}

/** Resolved tuning for one stage (defaults applied). */
export interface StageSettings {
  model?: string;
  thinking?: (typeof ThinkingLevels)[number];
}

/** The per-stage settings the pipeline hands to describe/structure/link. The
 *  defaults are the soak-tuned values: describe `minimal` (fast over a growing
 *  context), structure `low`, link `medium` (cross-graph synthesis earns more). */
export interface ResolvedStages {
  describe: StageSettings;
  structure: StageSettings;
  link: StageSettings;
}

const STAGE_DEFAULT_THINKING: Record<keyof ResolvedStages, StageSettings["thinking"]> = {
  describe: "minimal",
  structure: "low",
  link: "medium",
};

function resolveStages(config: SmoothieConfig): ResolvedStages {
  const fallbackModel = config.model?.default;
  const one = (name: keyof ResolvedStages): StageSettings => {
    const s = config.stages?.[name];
    return {
      model: s?.model ?? fallbackModel,
      thinking: s?.thinking ?? STAGE_DEFAULT_THINKING[name],
    };
  };
  return { describe: one("describe"), structure: one("structure"), link: one("link") };
}

/** The Brief's fields, fanned out to the BC sections that consume them (spec 02),
 *  plus the resolved per-stage runtime settings. */
export interface BriefFanOut {
  profile: string; // → manifest.profile
  brief: { brief_id: string; text: string; goals: SmoothieConfig["brief"]["goals"]; scope?: unknown; created_at: string };
  app?: { name?: string; base_url?: string; allowed_origins?: string[] }; // → manifest.app (web-app)
  authorship?: { author?: string; organization?: string };
  glossary: Record<string, { definition: string }>;
  policySeed: { danger: Array<{ match: string; level: string; reason: string }>; budget?: { max_actions?: number; max_pages?: number } };
  /** Resolvers to run at the resolve stage (from `verify.resolvers`); empty → no-op. */
  resolvers: string[];
  /** Resolved model + thinking budget per stage. */
  stages: ResolvedStages;
}

export function fanOut(config: SmoothieConfig, createdAt: string): BriefFanOut {
  const b = config.brief;
  const glossary: BriefFanOut["glossary"] = {};
  for (const g of b.glossary ?? []) glossary[g.term] = { definition: g.definition };

  return {
    profile: config.profile,
    brief: {
      brief_id: "brief-main",
      text: b.intent,
      goals: b.goals,
      scope: b.scope,
      created_at: createdAt,
    },
    app: config.profile === "web-app"
      ? { name: b.manifest?.app_name, base_url: b.target?.base_url, allowed_origins: b.target?.allowed_origins }
      : undefined,
    authorship: b.manifest ? { author: b.manifest.author, organization: b.manifest.organization } : undefined,
    glossary,
    policySeed: { danger: b.policy?.danger ?? [], budget: b.policy?.budget },
    resolvers: b.verify?.resolve === false ? [] : (b.verify?.resolvers ?? []),
    stages: resolveStages(config),
  };
}
