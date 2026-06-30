// describe (agent, per modality) — sources → facts in the single canonical Fact
// shape (spec 04; 02 · Facts).
//
// Two paths, selected by the gateway:
//   • REAL: the agent **writes and runs Python** to squeeze meaningful data out of
//     the source, guided by the per-modality **skill** Smoothie loads for it. The
//     agent cites a `locator` per fact (page/sheet/region) which CODE turns into
//     the provenance span — so a receipt always points at real evidence.
//   • DETERMINISTIC (CI): the built-in TS readers extract segments and the model
//     describes each, so "same input → same BC" stays testable without Python.

import * as fs from "node:fs";
import * as path from "node:path";
import { DescribeResult } from "../bc/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { IngestedSource } from "./ingest.ts";
import { textSegments, type Companion } from "../readers/index.ts";
import { loadReaderSkill, renderSkill } from "../agent/skills.ts";
import { pythonTool, commandTool } from "../agent/run-python.ts";
import { scaffoldToolkit, toolkitScripts } from "../agent/toolkit.ts";
import type { StageSettings } from "../config.ts";

export interface BcFact {
  fact_id: string;
  kind: "knowledge" | "action";
  text: string;
  confidence: number;
  view_id?: string;
  fidelity: "claimed" | "guessed";
  source_refs: Array<{ source_id: string; span: unknown }>;
  action_draft?: { verb: string; target: string; value_hint?: string; locator_hint?: string; expected_effect?: string };
  brief_id: string;
}

export interface DescribeResultBundle {
  facts: BcFact[];
  companions: Record<string, Companion[]>; // by source_id
}

const DESCRIBE_INSTRUCTION =
  "You are the describe stage of a multimodal data compiler. Your job is to extract " +
  "every meaningful fact from ONE source file, faithfully — never invent. Each fact " +
  "is `knowledge` or `action`. For every fact set a `locator` citing where in the " +
  "source it came from. Return JSON: { \"facts\": [ { \"kind\": \"knowledge\"|\"action\", " +
  "\"text\": string, \"confidence\": number(0..1), \"fidelity\": \"claimed\"|\"guessed\", " +
  "\"locator\": string, \"action_draft\"?: { \"verb\": ...|\"unknown\", \"target\": string } } ] }. " +
  "No fact_id, no other keys.";

export async function describe(
  sources: IngestedSource[],
  gateway: ModelGateway,
  bcDir: string,
  briefId: string,
  stage: StageSettings = {},
): Promise<DescribeResultBundle> {
  return gateway.extractWithTools
    ? describeWithAgent(sources, gateway, bcDir, briefId, stage)
    : describeWithReaders(sources, gateway, bcDir, briefId);
}

/** REAL path — the Python agent guided by the per-modality skill. */
async function describeWithAgent(
  sources: IngestedSource[],
  gateway: ModelGateway,
  bcDir: string,
  briefId: string,
  stage: StageSettings,
): Promise<DescribeResultBundle> {
  const facts: BcFact[] = [];
  const companions: Record<string, Companion[]> = {};
  // describe is brief-independent, so its output is CACHED per source (by content
  // hash) under `.smoothie/stages/describe/`. A re-run — or a different brief over
  // the same data — reuses the expensive extraction instead of re-running the
  // Python agent. Delete the cache (or change the file) to force re-extraction.
  const cacheDir = path.join(bcDir, "stages", "describe");
  fs.mkdirSync(cacheDir, { recursive: true });

  // Scaffold the pre-built modality toolkit into `.smoothie/tools/` once. The agent
  // orchestrates these scripts (via `uv run`) instead of writing extraction from
  // scratch; uv provisions an isolated env per script on first use.
  const toolkitDir = scaffoldToolkit(bcDir);

  for (const src of sources) {
    companions[src.source_id] = [];
    const cachePath = path.join(cacheDir, `${src.source_id}.json`);

    // Cache hit: same source content → reuse.
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { hash: string; facts: BcFact[] };
      if (cached.hash === src.hash) {
        // Re-stamp brief_id (the only brief-dependent field) and reuse.
        for (const f of cached.facts) facts.push({ ...f, brief_id: briefId });
        continue;
      }
    }

    // Cache miss: run the Python agent. Its working directory lives under
    // `.smoothie/work/<source>/` — the source copy + every Python script it ran
    // (kept for inspection; gitignored). A project `.smoothie/skills/<modality>/`
    // overrides the bundled reader skill.
    const skill = loadReaderSkill(src.kind, bcDir);
    const workDir = path.join(bcDir, "work", src.source_id);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const base = path.basename(src.path);
    fs.copyFileSync(src.path, path.join(workDir, base));

    const scripts = toolkitScripts(src.kind);
    const toolkitNote = scripts.length
      ? `A pre-built toolkit for this modality is at $SMOOTHIE_TOOLKIT/${src.kind}/ — scripts: ${scripts.join(", ")}. ` +
        `Run them with run_command, e.g. \`uv run "$SMOOTHIE_TOOLKIT/${src.kind}/${scripts[0]}" "${base}" --json\` ` +
        `(use --help to see options). Prefer these over writing extraction code; use run_python only for data-specific glue.`
      : `Use run_python to read and process it.`;

    const result = await gateway.extractWithTools!({
      label: `describe:${src.kind}`,
      system: `${DESCRIBE_INSTRUCTION}\n\n${renderSkill(skill)}`,
      user: `The source file "${base}" (modality: ${src.kind}) is in your working directory. ${toolkitNote} Then return the facts.`,
      schema: DescribeResult,
      tools: [commandTool(workDir, toolkitDir), pythonTool(workDir, toolkitDir)],
      maxSteps: 16,
      ...(stage.model ? { model: stage.model } : {}),
      ...(stage.thinking ? { reasoning: stage.thinking } : {}),
    });

    const sourceFacts: BcFact[] = result.facts.map((f, j) => ({
      fact_id: `${src.source_id}-f${j}`,
      kind: f.kind,
      text: f.text,
      confidence: f.confidence,
      view_id: f.view_id,
      fidelity: f.fidelity === "guessed" ? "guessed" : "claimed",
      // Provenance by code: the agent's locator becomes a doc span label.
      source_refs: [{ source_id: src.source_id, span: { kind: "doc", label: f.locator ?? "document" } }],
      action_draft: f.action_draft,
      brief_id: briefId,
    }));
    // Persist the per-source describe cache (the expensive intermediary).
    fs.writeFileSync(cachePath, JSON.stringify({ source_id: src.source_id, kind: src.kind, hash: src.hash, facts: sourceFacts }, null, 2) + "\n");
    facts.push(...sourceFacts);
  }

  return { facts, companions };
}

/** DETERMINISTIC path (CI only) — a trivial text split + per-segment describe.
 *  The real pipeline never uses this; it exists so "same input → same BC" stays
 *  testable without the non-deterministic Python agent. */
async function describeWithReaders(
  sources: IngestedSource[],
  gateway: ModelGateway,
  _bcDir: string,
  briefId: string,
): Promise<DescribeResultBundle> {
  const facts: BcFact[] = [];
  const companions: Record<string, Companion[]> = {};

  for (const src of sources) {
    companions[src.source_id] = [];
    const segments = textSegments(src.path);

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const result = await gateway.extract({
        label: `describe:${src.kind}`,
        instruction: DESCRIBE_INSTRUCTION,
        content: seg.text,
        schema: DescribeResult,
        ...(seg.image ? { images: [seg.image] } : {}),
      });

      result.facts.forEach((f, j) => {
        facts.push({
          fact_id: `${src.source_id}-s${s}-f${j}`,
          kind: f.kind,
          text: f.text,
          confidence: f.confidence,
          view_id: f.view_id,
          fidelity: f.fidelity === "guessed" ? "guessed" : "claimed",
          source_refs: [{ source_id: src.source_id, span: seg.span }],
          action_draft: f.action_draft,
          brief_id: briefId,
        });
      });
    }
  }

  return { facts, companions };
}
