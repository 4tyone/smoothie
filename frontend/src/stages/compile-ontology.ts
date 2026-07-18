// compile (ontology track, spec 02/09) — the OntologyDraft + facts + sources →
// a validated `ontology.json`. Deterministic: content-anchored ids, no wall-clock
// (SMOOTHIE_NOW), sorted keys. Enforces gates G1-G7 by invoking the real
// `svm validate --target ontology`. Same input → same ontology.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { BriefFanOut } from "../config.ts";
import type { OntologyDraft } from "./model.ts";
import type { BcFact } from "./describe.ts";

const sha12 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Recursively sort object keys so the written bytes are deterministic. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export interface OntologySourceInfo {
  source_id: string;
  kind: string;
  path?: string;
  hash?: string;
}

/** Reconciliation state carried from the prior version (spec 05 §4/§5). */
export interface Reconcile {
  parentVersionId?: string;
  operations?: unknown[];
  stability?: Record<string, number>;
  modelKind?: string;
}

export interface CompileOntologyInput {
  fanOut: BriefFanOut;
  sources: Record<string, OntologySourceInfo>;
  facts: BcFact[];
  draft: OntologyDraft;
  bcDir: string;
  svmBin: string;
  producerVersion: string;
  /** Notes to record (e.g. quarantined/recorded feedback, spec 08 §5). */
  notes?: unknown[];
  reconcile?: Reconcile;
}

export interface CompileOntologyOutput {
  ontologyPath: string;
  ontologyId: string;
  validated: boolean;
}

export function compileOntology(input: CompileOntologyInput): CompileOntologyOutput {
  const fan = input.fanOut;
  const now = process.env.SMOOTHIE_NOW ?? "2026-01-01T00:00:00Z";
  const { draft } = input;

  const sortedHashes = Object.values(input.sources).map((s) => s.hash ?? "").sort();
  const ontologyId = "ont-" + sha12(fan.brief.text + "|" + sortedHashes.join(","));
  const versionId = "v-" + sha12(ontologyId + "|" + sortedHashes.join(","));

  const sources: Record<string, unknown> = {};
  const sourceHashes: Record<string, string> = {};
  for (const [id, s] of Object.entries(input.sources)) {
    sources[id] = { source_id: s.source_id, kind: s.kind, ...(s.path ? { path: s.path } : {}), ...(s.hash ? { hash: s.hash } : {}) };
    sourceHashes[id] = s.hash ?? "";
  }

  const facts: Record<string, unknown> = {};
  for (const f of input.facts) {
    facts[f.fact_id] = {
      fact_id: f.fact_id,
      kind: f.kind,
      text: f.text,
      confidence: f.confidence,
      ...(f.view_id ? { view_id: f.view_id } : {}),
      fidelity: f.fidelity,
      source_refs: f.source_refs,
      brief_id: f.brief_id,
    };
  }

  const ontology = {
    schema: "ontology.v1",
    manifest: {
      ontology_id: ontologyId,
      schema: "ontology.v1",
      producer_version: input.producerVersion,
      profile: fan.profile,
      created_at: now,
      ...(fan.authorship && (fan.authorship.author || fan.authorship.organization)
        ? { authorship: pruneUndefined(fan.authorship) }
        : {}),
      counts: {
        entities: Object.keys(draft.entities).length,
        links: Object.keys(draft.links).length,
        facts: input.facts.length,
        entity_types: Object.keys(draft.entity_types).length,
        link_types: Object.keys(draft.link_types).length,
        resolutions: Object.keys(draft.resolutions).length,
      },
    },
    brief: { brief_id: fan.brief.brief_id, intent: fan.brief.text, goals: fan.brief.goals, created_at: fan.brief.created_at },
    sources,
    facts,
    entity_types: draft.entity_types,
    entities: draft.entities,
    link_types: draft.link_types,
    links: draft.links,
    resolutions: draft.resolutions,
    glossary: fan.glossary,
    notes: input.notes ?? [],
    policy: {},
    version: {
      version_id: versionId,
      ...(input.reconcile?.parentVersionId ? { parent_version_id: input.reconcile.parentVersionId } : {}),
      created_at: now,
      // The determinism envelope (spec 05 §5): pinned inputs sufficient to reproduce
      // or diff — source hashes plus the model and prompt versions per build.
      envelope: {
        source_hashes: sourceHashes,
        model: input.reconcile?.modelKind ?? "unknown",
        prompt_version: "ontology.model.v1",
        ...(input.reconcile?.parentVersionId ? { parent_version_id: input.reconcile.parentVersionId } : {}),
      },
      operations: input.reconcile?.operations ?? [],
    },
    // Emergent-schema stability counters (spec 05 §3), namespaced (reverse-DNS).
    extensions: input.reconcile?.stability
      ? { "com.smoothie.stability": { type_builds: input.reconcile.stability } }
      : {},
  };

  fs.mkdirSync(input.bcDir, { recursive: true });
  const ontologyPath = path.join(input.bcDir, "ontology.json");
  fs.writeFileSync(ontologyPath, JSON.stringify(canonical(ontology), null, 2) + "\n");

  let validated = false;
  try {
    execFileSync(input.svmBin, ["validate", ontologyPath], { encoding: "utf8" });
    validated = true;
  } catch (e) {
    const out = e as { stdout?: string; stderr?: string };
    throw new Error(`compile produced an invalid ontology:\n${out.stderr ?? out.stdout ?? (e as Error).message}`);
  }

  return { ontologyPath, ontologyId, validated };
}

function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out as Partial<T>;
}
