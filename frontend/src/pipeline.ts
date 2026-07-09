// The producer thread (spec 03): ingest → describe → structure → link → compile.
// (resolve lands in Phase 5.) Code drives; the model interprets only at
// describe/structure/link, behind the gateway — the agentic→deterministic
// principle. The pipeline is **incremental by construction** (spec 03): a new
// source weaves into an existing BC at `link` without rewriting what's there.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ingest } from "./stages/ingest.ts";
import { describe } from "./stages/describe.ts";
import { structure, structureBatch } from "./stages/structure.ts";
import { link, loadExisting, emptyExisting, evictSources, sourceOfRefs } from "./stages/link.ts";
import { resolve } from "./stages/resolve.ts";
import { compile, type CompileOutput } from "./stages/compile.ts";

import { Telemetry } from "./telemetry.ts";
import type { ModelGateway } from "./model/gateway.ts";

export interface CompileOptions {
  gateway: ModelGateway;
  svmBin: string;
  producerVersion?: string;
  bcDir?: string;
  /** Weave only *new* sources into an existing BC (default: auto when a BC exists). */
  incremental?: boolean;
  /** Commit the BC to git after compile (spec 03 · every write is a commit). */
  git?: boolean;
  /** Resolver names to run at `resolve` (overrides the Brief's `verify.resolvers`). */
  resolvers?: string[];
}

export interface CompileRun extends CompileOutput {
  telemetry: ReturnType<Telemetry["toJSON"]>;
  newSourceCount: number;
  /** Existing sources re-described because their content changed (spec 03). */
  changedSourceCount: number;
  /** Sources in the BC no longer present in the corpus (retained, surfaced). */
  deletedSourceIds: string[];
  carriedOverNodes: number;
}

export async function runCompile(folder: string, opts: CompileOptions): Promise<CompileRun> {
  const bcDir = opts.bcDir ?? path.join(folder, ".smoothie");
  const bcPath = path.join(bcDir, "bc.json");
  const tel = new Telemetry(`compile-${path.basename(folder)}`);

  // Every stage persists its output to `.smoothie/stages/` — the pipeline runs as
  // a sequence of inspectable, reusable files on disk, not one opaque RAM pass.
  const stagesDir = path.join(bcDir, "stages");
  fs.mkdirSync(stagesDir, { recursive: true });
  const writeStage = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(stagesDir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");

  // 1 · ingest (brief required + validated; classify; register sources)
  const ing = ingest(folder);
  const briefId = ing.fanOut.brief.brief_id;
  const baseUrl = ing.fanOut.app?.base_url ?? ing.fanOut.app?.allowed_origins?.[0] ?? "/";
  const urlPatterns = [baseUrl];

  // Incremental when a BC already exists (unless explicitly disabled).
  const incremental = (opts.incremental ?? true) && fs.existsSync(bcPath);
  let existing = incremental ? loadExisting(bcPath) : emptyExisting();

  // Classify each ingested source against the existing BC by content hash:
  //   • new     — not in the BC yet
  //   • changed — present but its content hash differs (an EDIT). Must be
  //     re-described and re-woven; leaving it alone would serve stale content
  //     behind valid-looking receipts (the exact "silent drop" the soak forbids).
  //   • unchanged — carried over verbatim.
  // Deleted sources (in the BC, absent now) are surfaced, not silently dropped.
  const existingHash = (sid: string): string | undefined => (existing.sources[sid] as { hash?: string } | undefined)?.hash;
  const newSources = ing.sources.filter((s) => !(s.source_id in existing.sources));
  const changedSources = ing.sources.filter((s) => s.source_id in existing.sources && existingHash(s.source_id) !== s.hash);
  const currentIds = new Set(ing.sources.map((s) => s.source_id));
  const deletedSourceIds = Object.keys(existing.sources).filter((sid) => !currentIds.has(sid));

  // Evict changed sources' stale artifacts, then reprocess them alongside new ones.
  if (changedSources.length) existing = evictSources(existing, new Set(changedSources.map((s) => s.source_id)));
  const reprocess = [...newSources, ...changedSources];

  const ingestNotes: string[] = [];
  if (ing.skipped.length) ingestNotes.push(`skipped (no Reader): ${ing.skipped.join(", ")}`);
  if (changedSources.length) ingestNotes.push(`changed (re-described): ${changedSources.map((s) => s.source_id).join(", ")}`);
  if (deletedSourceIds.length) ingestNotes.push(`deleted from corpus but retained in BC (run a full recompile to drop): ${deletedSourceIds.join(", ")}`);
  tel.stage("ingest", { sources: ing.sources.length, new: newSources.length, changed: changedSources.length, deleted: deletedSourceIds.length, incremental: incremental ? 1 : 0 }, ingestNotes.length ? ingestNotes : undefined);
  writeStage("1-ingest", {
    folder, profile: ing.fanOut.profile, brief: ing.fanOut.brief, resolvers: ing.fanOut.resolvers,
    sources: ing.sources.map((s) => ({ source_id: s.source_id, kind: s.kind, path: s.relPath, hash: s.hash })),
    skipped: ing.skipped, incremental,
    newSources: newSources.map((s) => s.source_id),
    changedSources: changedSources.map((s) => s.source_id),
    deletedSources: deletedSourceIds,
  });

  // Per-stage model + thinking budget, resolved from smoothie_config.yaml (defaults
  // applied): describe `minimal`, structure `low`, link `medium`.
  const stages = ing.fanOut.stages;

  // 2 · describe (new sources → facts; provenance attached by code; cached per source).
  // The describe context carries how to resolve processors (config modalities +
  // corpus folder) and the Brief, for modalities/processors that opt into it (spec 10).
  const describeCtx = { folder, modalities: ing.fanOut.modalities, briefJson: JSON.stringify(ing.fanOut.brief), redactPatterns: ing.fanOut.policySeed.redactPatterns };
  const { facts: newFacts, companions, skipped } = await describe(reprocess, opts.gateway, bcDir, briefId, stages.describe, describeCtx);
  const describeNotes = [`model: ${opts.gateway.kind}`];
  if (skipped.length) describeNotes.push(`skipped (extraction failed): ${skipped.map((s) => `${s.source_id} (${s.error})`).join("; ")}`);
  tel.stage("describe", { facts: newFacts.length, skipped: skipped.length }, describeNotes);
  writeStage("2-describe", { facts: newFacts, skipped });

  // 3 · structure — each new source into a LOCAL object (spec 03 · local). The real
  // model structures ALL new sources in ONE batched call (fewer round-trips,
  // leverages the context window); the deterministic CI gateway stays per-source so
  // "same input → same BC" holds byte-for-byte.
  const srcCtx = { profile: ing.fanOut.profile, urlPatterns, goals: ing.fanOut.brief.goals.map((g) => ({ id: g.id, text: g.text })) };
  const factsFor = (sid: string) =>
    newFacts.filter((f) => f.source_refs[0] && (f.source_refs[0] as { source_id: string }).source_id === sid);
  let newLocals: Awaited<ReturnType<typeof structure>>[];
  if (opts.gateway.kind === "real") {
    newLocals = await structureBatch(reprocess.map((s) => ({ sourceId: s.source_id, facts: factsFor(s.source_id) })), srcCtx, opts.gateway, stages.structure);
  } else {
    newLocals = [];
    for (const src of reprocess) newLocals.push(await structure(src.source_id, factsFor(src.source_id), srcCtx, opts.gateway, stages.structure));
  }
  tel.stage("structure", { sources: newLocals.length, nodes: newLocals.reduce((a, l) => a + l.nodes.length, 0) });
  writeStage("3-structure", { locals: newLocals });

  // 4 · link — weave the local objects into one graph (merge/induce/reconcile)
  const newSourcesMap: Record<string, unknown> = {};
  for (const s of reprocess) {
    newSourcesMap[s.source_id] = { source_id: s.source_id, kind: s.kind, path: s.relPath, hash: s.hash, companions: companions[s.source_id] ?? [] };
  }
  const merged = await link(existing, newSourcesMap, newFacts, newLocals,
    { profile: ing.fanOut.profile, briefId, goals: ing.fanOut.brief.goals }, opts.gateway, stages.link);
  // Telemetry distinguishes two different things that were previously conflated:
  //   • induced_edges  — edges the linker ADDED beyond each source's local set
  //     (includes within-source connections the structure pass missed).
  //   • cross_source_edges — edges whose two endpoints belong to DIFFERENT sources
  //     (the connection thesis: real bridges across the corpus). A node's source is
  //     its code-owned receipt (source_refs), not an id-prefix guess (which misfires
  //     when one source_id is a prefix of another). This is the honest number.
  const inducedCount = merged.edges.length - existing.edges.length - newLocals.reduce((a, l) => a + l.edges.length, 0);
  const nodeSource = new Map<string, string | null>();
  for (const n of merged.nodes) nodeSource.set(n.id as string, sourceOfRefs(n.source_refs));
  const crossSourceCount = merged.edges.filter((e) => {
    const a = nodeSource.get(e.from), b = nodeSource.get(e.to);
    return a && b && a !== b;
  }).length;
  tel.stage("link", {
    nodes: merged.nodes.length, edges: merged.edges.length, views: merged.views.length,
    induced_edges: Math.max(0, inducedCount), cross_source_edges: crossSourceCount,
    carried_over: merged.carriedOverNodeIds.length,
  });
  writeStage("4-link", merged);

  // 5 · resolve (pluggable & optional) — promotes claimed/guessed → confirmed in
  // place when a Resolver is requested; otherwise a no-op (spec 08).
  const requested = opts.resolvers ?? ing.fanOut.resolvers;
  const sourceText = (sid: string): string | undefined => {
    const s = merged.sources[sid] as { path?: string } | undefined;
    if (!s?.path) return undefined;
    try { return fs.readFileSync(path.join(folder, s.path), "utf8"); } catch { return undefined; }
  };
  const resolved = await resolve(merged, { profile: ing.fanOut.profile, requested, sourceText, gateway: opts.gateway });
  tel.stage("resolve", { promoted: resolved.promoted, resolvers: resolved.resolvers.length });
  writeStage("5-resolve", { promoted: resolved.promoted, resolvers: resolved.resolvers, graph: resolved.merged });

  // 6 · compile (assemble + rollups + write + validate via svm)
  const out = compile({ fanOut: ing.fanOut, merged: resolved.merged, bcDir, svmBin: opts.svmBin, producerVersion: opts.producerVersion ?? "0.1.0" });
  tel.stage("compile", { validated: out.validated ? 1 : 0 });

  fs.writeFileSync(path.join(bcDir, "telemetry.json"), JSON.stringify(tel.toJSON(), null, 2) + "\n");
  // The agent's Python work and the stage intermediaries are regenerable — kept
  // on disk for inspection + reuse (the describe cache), but not versioned.
  fs.writeFileSync(path.join(bcDir, ".gitignore"), "work/\nstages/\n");

  // Every write is a commit — auditable, diffable, rollback-able (spec 03/05).
  if (opts.git ?? true) gitCommit(bcDir, incremental ? `incremental: +${newSources.length} source(s)` : "compile");

  return {
    ...out,
    telemetry: tel.toJSON(),
    newSourceCount: newSources.length,
    changedSourceCount: changedSources.length,
    deletedSourceIds,
    carriedOverNodes: merged.carriedOverNodeIds.length,
  };
}

function gitCommit(dir: string, message: string): void {
  try {
    if (!fs.existsSync(path.join(dir, ".git"))) execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    // Nothing staged → a legitimate no-op (a re-compile with identical output).
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    if (!status.trim()) return;
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
  } catch (e) {
    // The BC is already written; a failed commit only costs history/rollback, so
    // warn loudly rather than crash — but never let "every write is a commit"
    // (spec 03/05) fail SILENTLY, which would void the audit story invisibly.
    const detail = (e as { stderr?: Buffer }).stderr?.toString().trim() || (e as Error).message;
    process.stderr.write(`⚠ smoothie: BC written but NOT committed to git (history/rollback unavailable this run): ${detail}\n`);
  }
}
