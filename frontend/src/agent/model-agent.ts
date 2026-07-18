// The MODEL stage's real path (spec 03) — the domain-modeling agent. Given the
// grounded facts, it proposes typed entities, their properties, and typed links, in
// the tolerant `ModelResult` shape; code (stages/model.ts) owns id assignment,
// resolution, and provenance. Phase 2 uses a single structured call; the TOC-style
// agentic navigation (link-agent.ts) is the scale path folded in later.
//
// Only the real (model-backed) gateway uses this; the deterministic gateway proposes
// mechanically in deterministic.ts so "same input → same ontology" stays byte-stable.

import type { InferOutput } from "valibot";
import { ModelResult } from "../ontology/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { StageSettings } from "../config.ts";
import type { BcFact } from "../stages/describe.ts";

interface GlossarySeed {
  term: string;
  definition: string;
  aliases?: string[];
  type?: string;
}

const SYSTEM =
  "You are the MODEL stage of an ontology compiler. From the given GROUNDED FACTS, " +
  "propose the real-world ENTITIES and the typed LINKS between them. Rules: never invent; " +
  "every entity and link must cite the `fact_ids` that support it. Give each entity a " +
  "short `type` noun (e.g. \"Company\", \"Segment\", \"Period\", \"Metric\"), a `label`, " +
  "and any surface-name `aliases` (plain strings). Use a CONSISTENT type name for entities " +
  "of the same kind. Treat glossary equivalence entries as the SAME entity across their " +
  "surface forms. Judge sameness by MEANING, not shared words. NEVER output ids — code " +
  "assigns them. Return JSON: { \"entities\": [ { \"type\": string, \"label\": string, " +
  "\"aliases\": [string], \"fact_ids\": [string] } ], \"links\": [ { \"link_type\": string, " +
  "\"from\": string (an entity label), \"to\": string (an entity label), \"fact_ids\": " +
  "[string], \"fidelity\": \"claimed\"|\"guessed\" } ] }.";

export interface ModelAgentInput {
  facts: BcFact[];
  glossarySeeds: GlossarySeed[];
  goals: Array<{ id: string; text: string }>;
}

export async function runModelAgent(
  input: ModelAgentInput,
  gateway: ModelGateway,
  stage: StageSettings = {},
): Promise<InferOutput<typeof ModelResult>> {
  const factLines = input.facts
    .map((f) => `- ${f.fact_id} [${f.source_refs[0]?.source_id ?? "?"}]: ${f.text}`)
    .join("\n");
  const glossary = input.glossarySeeds.length
    ? "\n\nGLOSSARY (authoritative equivalence + typing hints):\n" +
      input.glossarySeeds
        .map((g) => `- ${g.term}${g.type ? ` (type: ${g.type})` : ""}${g.aliases?.length ? ` = ${g.aliases.join(" / ")}` : ""}: ${g.definition}`)
        .join("\n")
    : "";
  const goals = input.goals.length ? `\n\nBrief goals (context only):\n${JSON.stringify(input.goals)}` : "";

  return gateway.extract({
    label: "model",
    instruction: SYSTEM,
    content: `GROUNDED FACTS:\n${factLines}${glossary}${goals}\n\nPropose the entities, properties, and links.`,
    schema: ModelResult,
    ...(stage.model ? { model: stage.model } : {}),
    ...(stage.thinking ? { reasoning: stage.thinking } : {}),
  });
}
