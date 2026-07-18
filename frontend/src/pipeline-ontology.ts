// The ontology-track producer thread (spec 00 §4, spec 09 §2): ingest → describe →
// model → resolve → compile → ontology.json. `ingest` and `describe` are SHARED with
// the bc track unchanged; the bc `structure`/`link` stages are replaced by
// `model` + `resolve`.
//
// The build is INCREMENTAL by construction (spec 05 §4): it classifies sources
// against the prior ontology (new/changed/unchanged/deleted), re-describes only
// new/changed sources, CARRIES unchanged facts forward, and re-runs model+resolve
// over the full fact set — so an incremental build converges to the same structural
// ontology as a cold build (incremental-equivalence, spec 09 §4). Content-anchored
// ids (spec 05 §2) give reuse-over-create for free. Each build is a git commit
// (spec 05 §7), so rollback and diff are reversible Operations.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ingest } from "./stages/ingest.ts";
import { describe } from "./stages/describe.ts";
import { runModel } from "./stages/model.ts";
import { resolveEntities } from "./stages/resolve-entities.ts";
import { applyFeedback } from "./stages/feedback.ts";
import { compileOntology, type OntologySourceInfo } from "./stages/compile-ontology.ts";
import { Telemetry } from "./telemetry.ts";
import type { ModelGateway } from "./model/gateway.ts";
import type { BcFact } from "./stages/describe.ts";

export interface OntologyCompileOptions {
  gateway: ModelGateway;
  svmBin: string;
  producerVersion?: string;
  bcDir?: string;
  /** Reconcile into an existing ontology (default: auto when one exists). */
  incremental?: boolean;
  /** Commit the ontology to git after compile (spec 05 §7). Default true. */
  git?: boolean;
}

export interface OntologyCompileRun {
  ontologyPath: string;
  ontologyId: string;
  validated: boolean;
  telemetry: ReturnType<Telemetry["toJSON"]>;
  newSourceCount: number;
  changedSourceCount: number;
  deletedSourceIds: string[];
  retiredEntityCount: number;
}

interface PriorOntology {
  sources: Record<string, { hash?: string }>;
  facts: BcFact[];
  entityIds: Set<string>;
  stability: Record<string, number>;
  typeStatus: Record<string, string>;
  typeSchemas: Record<string, unknown>;
  versionId?: string;
}

/** Load the prior ontology for incremental reconciliation (spec 05 §4). */
function loadPrior(ontologyPath: string, briefId: string): PriorOntology | null {
  if (!fs.existsSync(ontologyPath)) return null;
  let ont: {
    sources?: Record<string, { hash?: string }>;
    facts?: Record<string, BcFact & { fidelity: string }>;
    entities?: Record<string, unknown>;
    entity_types?: Record<string, { status?: string; property_schema?: unknown }>;
    extensions?: { "com.smoothie.stability"?: { type_builds?: Record<string, number> } };
    version?: { version_id?: string };
  };
  try {
    ont = JSON.parse(fs.readFileSync(ontologyPath, "utf8"));
  } catch {
    return null;
  }
  const sources = ont.sources ?? {};
  const facts: BcFact[] = Object.values(ont.facts ?? {}).map((f) => ({
    fact_id: f.fact_id,
    kind: f.kind,
    text: f.text,
    confidence: f.confidence,
    view_id: f.view_id,
    fidelity: (f.fidelity === "guessed" ? "guessed" : "claimed") as BcFact["fidelity"],
    source_refs: f.source_refs,
    brief_id: f.brief_id ?? briefId,
  }));
  const typeStatus: Record<string, string> = {};
  const typeSchemas: Record<string, unknown> = {};
  for (const [id, t] of Object.entries(ont.entity_types ?? {})) {
    if (t.status) typeStatus[id] = t.status;
    if (t.property_schema) typeSchemas[id] = t.property_schema;
  }
  return {
    sources,
    facts,
    entityIds: new Set(Object.keys(ont.entities ?? {})),
    stability: ont.extensions?.["com.smoothie.stability"]?.type_builds ?? {},
    typeStatus,
    typeSchemas,
    versionId: ont.version?.version_id,
  };
}

export async function runOntologyCompile(folder: string, opts: OntologyCompileOptions): Promise<OntologyCompileRun> {
  const bcDir = opts.bcDir ?? path.join(folder, ".smoothie");
  const ontologyPath = path.join(bcDir, "ontology.json");
  const tel = new Telemetry(`ontology-${path.basename(folder)}`);

  // Every stage writes its output to `.smoothie/stages/` as it completes (parity with
  // the bc pipeline): a crash mid-compile leaves the finished stages on disk to inspect,
  // and the `model` stage additionally caches per batch so it resumes without re-calling
  // the model for work already done (crash resilience).
  const stagesDir = path.join(bcDir, "stages");
  fs.mkdirSync(stagesDir, { recursive: true });
  const writeStage = (name: string, data: unknown): void => {
    const tmp = path.join(stagesDir, `${name}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, path.join(stagesDir, `${name}.json`));
  };

  // 1 · ingest
  const ing = ingest(folder);
  const briefId = ing.fanOut.brief.brief_id;
  const stages = ing.fanOut.stages;

  const incremental = (opts.incremental ?? true) && fs.existsSync(ontologyPath);
  const prior = incremental ? loadPrior(ontologyPath, briefId) : null;

  // Classify sources against the prior ontology (spec 05 §4.1).
  const priorSources = prior?.sources ?? {};
  const priorHash = (id: string): string | undefined => priorSources[id]?.hash;
  const newSources = ing.sources.filter((s) => !(s.source_id in priorSources));
  const changedSources = ing.sources.filter((s) => s.source_id in priorSources && priorHash(s.source_id) !== s.hash);
  const currentIds = new Set(ing.sources.map((s) => s.source_id));
  const unchangedIds = new Set(ing.sources.filter((s) => s.source_id in priorSources && priorHash(s.source_id) === s.hash).map((s) => s.source_id));
  const deletedSourceIds = Object.keys(priorSources).filter((id) => !currentIds.has(id));
  const reprocess = [...newSources, ...changedSources];
  tel.stage("ingest", { sources: ing.sources.length, new: newSources.length, changed: changedSources.length, deleted: deletedSourceIds.length, incremental: incremental ? 1 : 0 });
  writeStage("1-ingest", { brief_id: briefId, incremental, sources: ing.sources, new: newSources.map((s) => s.source_id), changed: changedSources.map((s) => s.source_id), deleted: deletedSourceIds });

  // 2 · describe new/changed; carry unchanged facts from the prior ontology.
  const describeCtx = {
    folder,
    modalities: ing.fanOut.modalities,
    briefJson: JSON.stringify(ing.fanOut.brief),
    redactPatterns: ing.fanOut.policySeed.redactPatterns,
  };
  const { facts: newFacts, skipped } = await describe(reprocess, opts.gateway, bcDir, briefId, stages.describe, describeCtx);
  const carriedFacts = prior ? prior.facts.filter((f) => unchangedIds.has(f.source_refs[0]?.source_id ?? "")) : [];
  const fullFacts = [...carriedFacts, ...newFacts];
  tel.stage("describe", { facts: fullFacts.length, new: newFacts.length, carried: carriedFacts.length, skipped: skipped.length }, [`model: ${opts.gateway.kind}`]);
  writeStage("2-describe", { facts: fullFacts, new: newFacts.length, carried: carriedFacts.length, skipped });

  // 3 · model — typed entities/links; code assigns ids + resolves by natural key. The
  // per-batch cache lives under stages/model, so a crash resumes from the last finished
  // batch instead of re-calling the model for every batch.
  const draft = await runModel(
    { facts: fullFacts, glossarySeeds: ing.fanOut.glossarySeeds, goals: ing.fanOut.brief.goals.map((g) => ({ id: g.id, text: g.text })) },
    opts.gateway,
    stages.model,
    path.join(stagesDir, "model"),
  );
  tel.stage("model", { entity_types: Object.keys(draft.entity_types).length, entities: Object.keys(draft.entities).length, links: Object.keys(draft.links).length });
  writeStage("3-model", draft);

  // 4 · resolve — gated, verified, reversible entity resolution (spec 04).
  const resolved = await resolveEntities({ entities: draft.entities, entity_types: draft.entity_types }, opts.gateway, ing.fanOut.resolution, stages.resolve);
  draft.entities = resolved.entities;
  draft.resolutions = resolved.resolutions;
  tel.stage("resolve", { merged: resolved.merged, resolutions: Object.keys(resolved.resolutions).length });
  writeStage("4-resolve", { entities: draft.entities, resolutions: draft.resolutions, merged: resolved.merged });

  // Feedback loop closure (spec 08 §5): apply pending consumer directives through the
  // same gates as agent proposals (a grounded add-link enters as guessed/consumer;
  // an ungrounded one is quarantined as a note, never a link).
  const feedback = applyFeedback(bcDir, draft, fullFacts);
  tel.stage("feedback", { applied_links: feedback.appliedLinks, quarantined: feedback.quarantined, notes: feedback.notes.length });
  writeStage("5-feedback", { applied_links: feedback.appliedLinks, quarantined: feedback.quarantined, notes: feedback.notes });

  // Open/closed reconciliation (spec 05 §3): reuse prior status, freeze closed
  // schemas, and close a type once it has been stable across `close_after_builds`.
  const closeAfter = ing.fanOut.schema.close_after_builds;
  const stability: Record<string, number> = {};
  for (const [typeId, t] of Object.entries(draft.entity_types)) {
    const builds = (prior?.stability[typeId] ?? 0) + 1;
    stability[typeId] = builds;
    const wasClosed = prior?.typeStatus[typeId] === "closed";
    t.status = wasClosed || builds >= closeAfter ? "closed" : "open";
    if (wasClosed && prior?.typeSchemas[typeId]) {
      t.property_schema = prior.typeSchemas[typeId] as typeof t.property_schema; // frozen
    }
  }

  // Retirement (spec 05 §4.5): a prior entity absent from this build lost its
  // grounding — recorded as a deprecate Operation, never silently dropped.
  const newEntityIds = new Set(Object.keys(draft.entities));
  const retired = prior ? [...prior.entityIds].filter((id) => !newEntityIds.has(id)) : [];
  const operations = retired.map((entity_id) => ({ op: "deprecate_entity", entity_id, reason: "grounding removed (source changed or deleted)" }));

  // 5 · compile — assemble + write + validate (svm --target ontology, gates G1-G7).
  const sources: Record<string, OntologySourceInfo> = {};
  for (const s of ing.sources) sources[s.source_id] = { source_id: s.source_id, kind: s.kind, path: s.relPath, hash: s.hash };

  const out = compileOntology({
    fanOut: ing.fanOut,
    sources,
    facts: fullFacts,
    draft,
    bcDir,
    svmBin: opts.svmBin,
    producerVersion: opts.producerVersion ?? "0.1.0",
    notes: feedback.notes,
    reconcile: { parentVersionId: prior?.versionId, operations, stability, modelKind: opts.gateway.kind },
  });
  tel.stage("compile", { validated: out.validated ? 1 : 0, retired: retired.length });

  // Every build is a commit — the versioned, rollback-able, diffable store (spec 05 §7).
  if (opts.git ?? true) gitCommit(bcDir, "ontology.json", incremental ? `ontology incremental: +${newSources.length} source(s)` : "ontology compile");

  return {
    ...out,
    telemetry: tel.toJSON(),
    newSourceCount: newSources.length,
    changedSourceCount: changedSources.length,
    deletedSourceIds,
    retiredEntityCount: retired.length,
  };
}

/** Commit ontology.json to a git-backed store with a deterministic identity (so CI
 *  runners without a global git user still commit). Non-fatal on failure. */
function gitCommit(dir: string, file: string, message: string): void {
  try {
    if (!fs.existsSync(path.join(dir, ".git"))) execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", file], { cwd: dir });
    const status = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: dir, encoding: "utf8" });
    if (!status.trim()) return;
    execFileSync("git", ["-c", "user.name=Smoothie", "-c", "user.email=smoothie@smoothie.local", "commit", "-q", "-m", message, "--", file], { cwd: dir });
  } catch (e) {
    const detail = (e as { stderr?: Buffer }).stderr?.toString().trim() || (e as Error).message;
    process.stderr.write(`⚠ smoothie: ontology written but NOT committed (history/rollback unavailable this run): ${detail}\n`);
  }
}
