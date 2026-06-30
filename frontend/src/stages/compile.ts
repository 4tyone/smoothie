// compile (code, deterministic) — all sections → a validated BC (spec 03; 02).
//
// Assembles the bc.v1 JSON, computes outline/scene/view fidelity rollups (an
// outline is no more trusted than the least of what it depends on), writes
// `bc.json` deterministically (sorted keys, no wall-clock), and enforces the
// provenance-guarantee gates by invoking the real `svm validate`. Same input →
// same BC.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { BriefFanOut } from "../config.ts";
import type { MergedGraph } from "./link.ts";

const RANK: Record<string, number> = { confirmed: 3, claimed: 2, guessed: 1, absent: 0 };
const fidMin = (a: string, b: string): string => (RANK[a] <= RANK[b] ? a : b);

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

export interface CompileInput {
  fanOut: BriefFanOut;
  merged: MergedGraph;
  bcDir: string;
  svmBin: string;
  producerVersion: string;
}

export interface CompileOutput {
  bcPath: string;
  bcId: string;
  validated: boolean;
}

export function compile(input: CompileInput): CompileOutput {
  const { merged } = input;
  const fan = input.fanOut;
  const now = process.env.SMOOTHIE_NOW ?? "2026-01-01T00:00:00Z";

  // Deterministic bc_id from the brief + source hashes (link assembled the sources).
  const sourceHashes = Object.values(merged.sources).map((s) => (s as { hash?: string }).hash ?? "").sort();
  const idMaterial = fan.brief.text + "|" + sourceHashes.join(",");
  const bcId = "bc-" + crypto.createHash("sha256").update(idMaterial).digest("hex").slice(0, 12);

  // ── sources (assembled by link: existing + new) ──
  const sources: Record<string, unknown> = merged.sources;

  // ── facts ──
  const factsOut: Record<string, unknown> = {};
  for (const f of merged.facts) {
    factsOut[f.fact_id] = {
      fact_id: f.fact_id, kind: f.kind, text: f.text, confidence: f.confidence,
      ...(f.view_id ? { view_id: f.view_id } : {}),
      fidelity: f.fidelity, source_refs: f.source_refs, brief_id: f.brief_id,
      ...(f.action_draft ? { action_draft: f.action_draft } : {}),
    };
  }

  // ── graph ──
  const nodeFid = new Map<string, string>();
  const nodes: Record<string, unknown> = {};
  for (const n of merged.nodes) {
    nodeFid.set(n.id, (n.fidelity as string) ?? "claimed");
    nodes[n.id] = {
      id: n.id, title: n.title, summary: n.summary ?? null, kind: n.kind,
      ...(n.view_id ? { view_id: n.view_id } : {}),
      fact_ids: n.fact_ids,
      ...(n.action ? { action: normalizeAction(n.action as Record<string, unknown>) } : {}),
      checks: (n.checks as unknown[]) ?? [],
      ...(n.done_when ? { done_when: n.done_when } : {}),
      fidelity: n.fidelity, source_refs: n.source_refs,
    };
  }
  const edges = merged.edges.map((e) => ({
    from: e.from, to: e.to, kind: e.kind,
    ...(e.label ? { label: e.label } : {}),
    fidelity: e.fidelity, source_refs: e.source_refs,
  }));

  // ── views (rollup: no more trusted than the least node) ──
  const views: Record<string, unknown> = {};
  for (const v of merged.views) {
    const memberIds = (v.node_ids as string[]) ?? [];
    const roll = memberIds.reduce((acc, id) => fidMin(acc, nodeFid.get(id) ?? "claimed"), "confirmed");
    views[v.view_id] = {
      view_id: v.view_id, title: v.title,
      ...(v.url_patterns ? { url_patterns: v.url_patterns } : {}),
      node_ids: memberIds, fidelity: memberIds.length ? roll : v.fidelity, observations: [],
    };
  }

  // ── outlines (rollup at scene and outline level) ──
  const outlines: Record<string, unknown> = {};
  for (const o of merged.outlines) {
    const scenes = ((o.scenes as Array<Record<string, unknown>>) ?? []).map((sc) => {
      const ids = (sc.node_ids as string[]) ?? [];
      const roll = ids.reduce((acc, id) => fidMin(acc, nodeFid.get(id) ?? "claimed"), "confirmed");
      return { ...sc, fidelity: ids.length ? roll : sc.fidelity };
    });
    const outlineRoll = scenes.reduce((acc, sc) => fidMin(acc, sc.fidelity as string), "confirmed");
    outlines[o.outline_id] = {
      outline_id: o.outline_id, brief_id: o.brief_id, title: o.title,
      scenes, fidelity: scenes.length ? outlineRoll : o.fidelity,
    };
  }

  // ── notes (gaps) ──
  const notes: Record<string, unknown> = {};
  for (const g of merged.gaps) {
    notes[g.key.startsWith("gap:") ? g.key : `gap:${g.key}`] = { text: g.text, ...(g.kind ? { kind: g.kind } : {}) };
  }

  // ── policy (web-app: scope from app identity + Brief seed; corpus: empty) ──
  const isWebApp = fan.profile === "web-app";
  const policy = isWebApp
    ? {
        scope: { allowed_origins: fan.app?.allowed_origins ?? [], url_denylist: [], same_origin_only: true },
        actions: { blocklist_verbs: [], allow_irreversible: false, allow_form_submit: true, allow_rules: [], danger: fan.policySeed.danger },
        ...(fan.policySeed.budget ? { budget: fan.policySeed.budget } : {}),
        approval: { require_for: "irreversible", handler: "interactive" },
        secrets: { redact_patterns: [] },
      }
    : {};

  const bc = {
    schema: "bc.v1",
    manifest: {
      bc_id: bcId,
      profile: fan.profile,
      ...(fan.app && (fan.app.name || fan.app.base_url) ? { app: pruneUndefined(fan.app) } : {}),
      producer: { name: "smoothie", version: input.producerVersion },
      created_at: now,
      updated_at: now,
      counts: {
        sources: Object.keys(merged.sources).length,
        facts: merged.facts.length,
        nodes: merged.nodes.length,
        edges: merged.edges.length,
        views: merged.views.length,
        outlines: merged.outlines.length,
      },
      ...(fan.authorship && (fan.authorship.author || fan.authorship.organization)
        ? { authorship: pruneUndefined(fan.authorship) }
        : {}),
    },
    brief: { brief_id: fan.brief.brief_id, text: fan.brief.text, goals: fan.brief.goals, created_at: fan.brief.created_at },
    sources,
    facts: factsOut,
    graph: { nodes, edges, ...(merged.nodes.length ? { roots: [merged.nodes[0].id] } : {}) },
    views,
    outlines,
    glossary: fan.glossary,
    notes,
    cache: { hot: [], trending: [], shadow: [] },
    policy,
    extensions: { "com.smoothie.producer": { reader_kinds: [...new Set(Object.values(merged.sources).map((s) => (s as { kind: string }).kind))].sort() } },
  };

  // Write deterministically.
  fs.mkdirSync(input.bcDir, { recursive: true });
  const bcPath = path.join(input.bcDir, "bc.json");
  fs.writeFileSync(bcPath, JSON.stringify(canonical(bc), null, 2) + "\n");

  // Enforce the provenance-guarantee gates via the real consumer.
  let validated = false;
  try {
    execFileSync(input.svmBin, ["validate", bcPath], { encoding: "utf8" });
    validated = true;
  } catch (e) {
    const out = (e as { stdout?: string; stderr?: string });
    throw new Error(`compile produced an invalid BC:\n${out.stderr ?? out.stdout ?? (e as Error).message}`);
  }

  return { bcPath, bcId, validated };
}

function normalizeAction(action: Record<string, unknown>): Record<string, unknown> {
  // The structure draft uses a flat action; emit the bc.v1 tagged shape.
  const kind = action.kind as string;
  if (kind === "goto") return { kind: "goto", url: action.url ?? "/" };
  if (kind === "click") return { kind: "click", locator: action.locator };
  if (kind === "fill") return { kind: "fill", locator: action.locator, value: action.value ?? "" };
  if (kind === "select") return { kind: "select", locator: action.locator, value: action.value ?? "" };
  if (kind === "press") return { kind: "press", key: action.key ?? "Enter" };
  return { kind: "click", locator: action.locator };
}

function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
