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
import { DescribeResult, type Fact } from "../bc/schemas.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { IngestedSource } from "./ingest.ts";
import { textSegments, type Companion } from "../readers/index.ts";
import { renderSkill } from "../agent/skills.ts";
import { pythonTool, commandTool } from "../agent/run-python.ts";
import { scaffoldToolkit } from "../agent/toolkit.ts";
import { resolveProcessor } from "../processors/resolve.ts";
import { runFetch, runExtract, processorEnv, type SourceDescriptor } from "../processors/run.ts";
import type { StageSettings, ModalityConfig } from "../config.ts";

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

/** What the real path needs beyond the sources: how to resolve processors. */
export interface DescribeCtx {
  /** Corpus folder — resolves processor `path`/`skill` relative to config. */
  folder: string;
  /** Config-declared modalities (spec 10); empty → built-in processors only. */
  modalities: Record<string, ModalityConfig>;
  /** The Brief as JSON, exposed to opt-in processors via `SMOOTHIE_BRIEF`. */
  briefJson?: string;
}

export async function describe(
  sources: IngestedSource[],
  gateway: ModelGateway,
  bcDir: string,
  briefId: string,
  stage: StageSettings = {},
  ctx: DescribeCtx = { folder: bcDir, modalities: {} },
): Promise<DescribeResultBundle> {
  return gateway.extractWithTools
    ? describeWithAgent(sources, gateway, bcDir, briefId, stage, ctx)
    : describeWithReaders(sources, gateway, bcDir, briefId);
}

/** Materialize provenance for proposed facts — code owns the receipt: bind each to
 *  the real source, and prefer a structured `span` over the locator label. */
function materializeFacts(facts: Fact[], sourceId: string, briefId: string): BcFact[] {
  return facts.map((f, j) => ({
    fact_id: `${sourceId}-f${j}`,
    kind: f.kind,
    text: f.text,
    confidence: f.confidence,
    view_id: f.view_id,
    fidelity: f.fidelity === "guessed" ? "guessed" : "claimed",
    source_refs: [{ source_id: sourceId, span: f.span ?? { kind: "doc", label: f.locator ?? "document" } }],
    action_draft: f.action_draft,
    brief_id: briefId,
  }));
}

/** REAL path (spec 10) — per source, resolve its processor (config or built-in) and
 *  either drive it with the agent (`agent`) or run its `extract` command with no
 *  model (`direct`). Provenance is materialized by code either way. */
async function describeWithAgent(
  sources: IngestedSource[],
  gateway: ModelGateway,
  bcDir: string,
  briefId: string,
  stage: StageSettings,
  ctx: DescribeCtx,
): Promise<DescribeResultBundle> {
  const facts: BcFact[] = [];
  const companions: Record<string, Companion[]> = {};
  // describe is brief-independent, so its output is CACHED per source (by content
  // hash + processor identity) under `.smoothie/stages/describe/`. A re-run, or a
  // different brief over the same data, reuses the expensive extraction. Changing
  // the processor (or the file) invalidates the entry.
  const cacheDir = path.join(bcDir, "stages", "describe");
  fs.mkdirSync(cacheDir, { recursive: true });
  // Scaffold the bundled toolkit into `.smoothie/tools/` once (the built-in
  // processors invoke it via `uv run`; custom processors may ignore it).
  const toolkitDir = scaffoldToolkit(bcDir);

  for (const src of sources) {
    companions[src.source_id] = [];
    const proc = resolveProcessor(src.kind, { folder: ctx.folder, modalities: ctx.modalities }, bcDir);
    const cachePath = path.join(cacheDir, `${src.source_id}.json`);

    // Cache hit: same content AND same processor identity → reuse.
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { hash: string; identity?: string; facts: BcFact[]; companions?: Companion[] };
      if (cached.hash === src.hash && cached.identity === proc.identity) {
        for (const f of cached.facts) facts.push({ ...f, brief_id: briefId });
        companions[src.source_id] = cached.companions ?? [];
        continue;
      }
    }

    // Fresh workdir under `.smoothie/work/<source>/`: the source copy + everything
    // the processor/agent ran (kept for inspection; gitignored).
    const base = path.basename(src.uri ?? src.path);
    const workDir = path.join(bcDir, "work", src.source_id);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    const desc: SourceDescriptor = {
      source_id: src.source_id, path: base, uri: src.uri, modality: src.kind,
      workdir: workDir, toolkitDir, processorDir: proc.processorDir, briefJson: ctx.briefJson,
    };
    // Localize the source: fetch a remote one, else copy the local file in.
    if (src.uri && proc.fetch) runFetch(proc, desc);
    else fs.copyFileSync(src.path, path.join(workDir, base));

    let sourceFacts: BcFact[];
    let srcCompanions: Companion[] = [];

    if (proc.orchestration === "direct") {
      // Deterministic path: run the processor's extract command(s), take the facts.
      const envelopes = runExtract(proc, desc);
      sourceFacts = materializeFacts(envelopes.flatMap((e) => e.facts), src.source_id, briefId);
      srcCompanions = envelopes.flatMap((e) => e.companions ?? []).map((c) => ({ kind: c.kind as Companion["kind"], path: c.path }));
    } else {
      // Agent orchestration: drive the processor's commands, guided by its skill.
      const cmdNote = proc.commands.length
        ? "Navigate the source with these processor commands (run them via run_command, as many " +
          "times and with whatever args you need). Prefer them over writing extraction code; use " +
          "run_python only for glue:\n" +
          proc.commands.map((c) => `  - ${c.name}: \`${c.run}\`${c.description ? ` — ${c.description}` : ""}`).join("\n")
        : "Use run_python to read and process the source.";
      const srcEnv = processorEnv(desc);
      const result = await gateway.extractWithTools!({
        label: `describe:${src.kind}`,
        system: `${DESCRIBE_INSTRUCTION}\n\n${renderSkill(proc.skill)}`,
        user: `The source file "${base}" (modality: ${src.kind}) is at $SMOOTHIE_SOURCE_PATH in your working directory. ${cmdNote} Then return the facts.`,
        schema: DescribeResult,
        tools: [commandTool(workDir, toolkitDir, srcEnv), pythonTool(workDir, toolkitDir, srcEnv)],
        maxSteps: 16,
        ...(stage.model ? { model: stage.model } : {}),
        ...(stage.thinking ? { reasoning: stage.thinking } : {}),
      });
      sourceFacts = materializeFacts(result.facts, src.source_id, briefId);
    }

    companions[src.source_id] = srcCompanions;
    fs.writeFileSync(cachePath, JSON.stringify({ source_id: src.source_id, kind: src.kind, hash: src.hash, identity: proc.identity, facts: sourceFacts, companions: srcCompanions }, null, 2) + "\n");
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
