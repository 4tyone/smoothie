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
import { readImageTool } from "../agent/read-image.ts";
import { buildRedactor } from "../redact.ts";
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
  /** Sources whose extraction failed and were skipped (no facts) — surfaced, not
   *  fatal. A re-compile retries them (their cache was never written). */
  skipped: Array<{ source_id: string; error: string }>;
}

const DESCRIBE_INSTRUCTION =
  "You are the describe stage of a multimodal data compiler. Your job is to extract " +
  "every meaningful fact from ONE source file, faithfully — never invent. Each fact " +
  "is `knowledge` or `action`. For every fact set a `locator` citing where in the " +
  "source it came from; for time-based media prefer the structured `span` " +
  "({ \"kind\": \"time\", \"t_start\": seconds, \"t_end\": seconds }). NEVER author a fact " +
  "about what an image/frame shows without first attaching it via read_image — you " +
  "cannot see a file you have not attached. Return JSON: { \"facts\": [ { \"kind\": " +
  "\"knowledge\"|\"action\", \"text\": string, \"confidence\": number(0..1), \"fidelity\": " +
  "\"claimed\"|\"guessed\", \"locator\": string, \"span\"?: { \"kind\": \"time\", \"t_start\": " +
  "number, \"t_end\": number }, \"action_draft\"?: { \"verb\": ...|\"unknown\", \"target\": " +
  "string } } ] }. No fact_id, no keys beyond these.";

/** Modalities whose extraction is pixel-bearing — the agent gets more steps for
 *  the probe → index → extract → read_image → deep-read loop. */
const VISUAL_MODALITIES = new Set(["image", "video", "pdf", "notebook"]);

/** How many sources `describe` extracts concurrently. Sources are independent
 *  (own workdir, own cache, receipts bound to their own source by code), so the
 *  fan-out is a pure wall-clock win — describe dominates the pipeline. The cap is
 *  the tighter of the model endpoint's rate limit and local compute (whisper/ffmpeg
 *  are CPU-bound); tune with `SMOOTHIE_DESCRIBE_CONCURRENCY` (default 4). */
function describeConcurrency(): number {
  const n = Number(process.env.SMOOTHIE_DESCRIBE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** Run `fn` over `items` with at most `limit` in flight; results stay in INPUT
 *  order (not completion order), so downstream assembly is deterministic. The
 *  orchestration is CODE, not a model — the fan-out is a for-loop that happens to
 *  be concurrent, keeping non-determinism confined to inside each source. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Copy workdir artifacts into `.smoothie/companions/<source>/…` and return the
 *  registered companions with bcDir-relative paths. The workdir is regenerable
 *  and gitignored; companions are receipts, so they must be durable + versioned
 *  (spec 02 · companions referenced by path). Missing files are skipped. */
function persistCompanions(
  bcDir: string,
  sourceId: string,
  workDir: string,
  items: Array<{ kind: Companion["kind"]; relPath: string }>,
): Companion[] {
  const out: Companion[] = [];
  const seen = new Set<string>();
  for (const { kind, relPath } of items) {
    const relDest = path.join("companions", sourceId, relPath);
    if (seen.has(relDest)) continue;
    seen.add(relDest);
    try {
      const to = path.join(bcDir, relDest);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(workDir, relPath), to);
      out.push({ kind, path: relDest });
    } catch {
      /* artifact vanished — a companion that can't be copied is not registered */
    }
  }
  return out;
}

/** What the real path needs beyond the sources: how to resolve processors. */
export interface DescribeCtx {
  /** Corpus folder — resolves processor `path`/`skill` relative to config. */
  folder: string;
  /** Config-declared modalities (spec 10); empty → built-in processors only. */
  modalities: Record<string, ModalityConfig>;
  /** The Brief as JSON, exposed to opt-in processors via `SMOOTHIE_BRIEF`. */
  briefJson?: string;
  /** Secret patterns (from `policy.secrets.redact_patterns`) redacted from fact
   *  text; the built-in secret shapes always apply (spec 06 · §2). */
  redactPatterns?: string[];
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
 *  the real source, and prefer a structured `span` over the locator label. Secrets
 *  are redacted here so they never enter the fact pool, the BC, or the cache on
 *  disk (spec 06 · §2). */
function materializeFacts(facts: Fact[], sourceId: string, briefId: string, redact: (s: string) => string): BcFact[] {
  return facts.map((f, j) => ({
    fact_id: `${sourceId}-f${j}`,
    kind: f.kind,
    text: redact(f.text),
    confidence: f.confidence,
    view_id: f.view_id,
    fidelity: f.fidelity === "guessed" ? "guessed" : "claimed",
    source_refs: [{ source_id: sourceId, span: f.span ?? { kind: "doc", label: f.locator ?? "document" } }],
    action_draft: f.action_draft
      ? { ...f.action_draft, target: redact(f.action_draft.target), ...(f.action_draft.value_hint ? { value_hint: redact(f.action_draft.value_hint) } : {}) }
      : undefined,
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
  const redact = buildRedactor(ctx.redactPatterns);
  // Scaffold the bundled toolkit into `.smoothie/tools/` once (the built-in
  // processors invoke it via `uv run`; custom processors may ignore it).
  const toolkitDir = scaffoldToolkit(bcDir);

  // Extract ONE source → its facts + companions. Self-contained (own workdir, own
  // cache file, receipts bound to its own source_id), so many can run at once.
  const processSource = async (src: IngestedSource): Promise<{ facts: BcFact[]; companions: Companion[] }> => {
    const proc = resolveProcessor(src.kind, { folder: ctx.folder, modalities: ctx.modalities }, bcDir);
    const cachePath = path.join(cacheDir, `${src.source_id}.json`);

    // Cache hit: same content AND same processor identity → reuse.
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { hash: string; identity?: string; facts: BcFact[]; companions?: Companion[] };
      if (cached.hash === src.hash && cached.identity === proc.identity) {
        return { facts: cached.facts.map((f) => ({ ...f, brief_id: briefId })), companions: cached.companions ?? [] };
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
    if (src.uri) {
      // A remote source needs its modality's `fetch` to localize it; without one
      // there's nothing to copy. Fail clearly instead of an opaque ENOENT on "".
      if (!proc.fetch) {
        throw new Error(`source ${src.source_id} is remote (${src.uri}) but modality "${src.kind}" declares no fetch step`);
      }
      runFetch(proc, desc);
    } else {
      fs.copyFileSync(src.path, path.join(workDir, base));
    }

    let sourceFacts: BcFact[];
    let srcCompanions: Companion[] = [];

    if (proc.orchestration === "direct") {
      // Deterministic path: run the processor's extract command(s), take the facts.
      // Envelope companion paths are workdir-relative (spec 10); persist them under
      // `.smoothie/companions/<source>/` so the receipts resolve after the workdir
      // is cleaned and the BC is versioned/moved.
      const envelopes = runExtract(proc, desc);
      sourceFacts = materializeFacts(envelopes.flatMap((e) => e.facts), src.source_id, briefId, redact);
      srcCompanions = persistCompanions(
        bcDir, src.source_id, workDir,
        envelopes.flatMap((e) => e.companions ?? []).map((c) => ({ kind: c.kind as Companion["kind"], relPath: c.path })),
      );
    } else {
      // Agent orchestration: drive the processor's commands, guided by its skill.
      const cmdNote = proc.commands.length
        ? "Navigate the source with these processor commands (run them via run_command, as many " +
          "times and with whatever args you need). Prefer them over writing extraction code; use " +
          "run_python only for glue:\n" +
          proc.commands.map((c) => `  - ${c.name}: \`${c.run}\`${c.description ? ` — ${c.description}` : ""}`).join("\n")
        : "Use run_python to read and process the source.";
      const srcEnv = processorEnv(desc);
      // Every image the agent actually looked at becomes a companion — the visual
      // receipt is a real, versioned file, not a path into a cleaned-up workdir.
      const viewed = new Set<string>();
      const result = await gateway.extractWithTools!({
        label: `describe:${src.kind}`,
        system: `${DESCRIBE_INSTRUCTION}\n\n${renderSkill(proc.skill)}`,
        user: `The source file "${base}" (modality: ${src.kind}) is at $SMOOTHIE_SOURCE_PATH in your working directory. ${cmdNote} Then return the facts.`,
        schema: DescribeResult,
        tools: [
          commandTool(workDir, toolkitDir, srcEnv),
          pythonTool(workDir, toolkitDir, srcEnv),
          readImageTool(workDir, (rel) => viewed.add(rel)),
        ],
        // Visual modalities need more steps: probe → index → extract frames →
        // read_image bursts → deeper reads.
        maxSteps: VISUAL_MODALITIES.has(src.kind) ? 32 : 16,
        ...(stage.model ? { model: stage.model } : {}),
        ...(stage.thinking ? { reasoning: stage.thinking } : {}),
      });
      sourceFacts = materializeFacts(result.facts, src.source_id, briefId, redact);
      srcCompanions = persistCompanions(
        bcDir, src.source_id, workDir,
        [...viewed].sort().map((relPath) => ({ kind: "frame" as Companion["kind"], relPath })),
      );
    }

    // Flush this source's cache the moment it completes, so a crash mid-run resumes
    // from here (a days-long compile WILL be interrupted).
    fs.writeFileSync(cachePath, JSON.stringify({ source_id: src.source_id, kind: src.kind, hash: src.hash, identity: proc.identity, facts: sourceFacts, companions: srcCompanions }, null, 2) + "\n");
    return { facts: sourceFacts, companions: srcCompanions };
  };

  // Fan out across sources (bounded concurrency); assemble in SOURCE order so the
  // result is independent of which source finished first. A single source's
  // failure is ISOLATED — it's skipped (no facts) and surfaced, never fatal:
  // aborting a long multi-source run over one bad extraction wastes everything,
  // and the failed source's cache was never written, so a re-compile retries it.
  const skipped: DescribeResultBundle["skipped"] = [];
  const results = await mapPool(sources, describeConcurrency(), async (src) => {
    try {
      return await processSource(src);
    } catch (e) {
      const error = (e as Error).message ?? String(e);
      skipped.push({ source_id: src.source_id, error });
      process.stderr.write(`⚠ smoothie: describe failed for ${src.source_id} — skipped (no facts): ${error}\n`);
      return { facts: [] as BcFact[], companions: [] as Companion[] };
    }
  });
  for (let i = 0; i < sources.length; i++) {
    companions[sources[i].source_id] = results[i].companions;
    facts.push(...results[i].facts);
  }

  return { facts, companions, skipped };
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

  return { facts, companions, skipped: [] };
}
