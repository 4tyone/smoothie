// Processor resolution (spec 10 - ADR-0003) - the open input contract.
//
// A **modality** is resolved from config (custom, first-matching) -> the built-in
// extension map -> `generic`. A **processor** is either a config entry (an inline
// `run` command, or a `path` to a package dir with a `manifest.json` + `SKILL.md`)
// or a **built-in** one: the bundled per-modality toolkit + reader skill, made a
// first-class processor here (the "stdlib" processors - no special lane).
//
// This module is pure resolution: it does not run anything. `describe` (agent or
// direct) consumes a `ResolvedProcessor` and drives its commands.

import * as fs from "node:fs";
import * as path from "node:path";
import { classifyModality } from "../readers/index.ts";
import { loadReaderSkill, loadSkillFromDir, type ReaderSkill } from "../agent/skills.ts";
import { bundledToolkitDir } from "../agent/toolkit.ts";
import type { ModalityConfig } from "../config.ts";

/** A single command the agent may drive (or `direct` runs): a shell template plus
 *  what it prints - `text` (render/query, the agent reads it) or `extract` (an
 *  `smoothie.extraction.v1` envelope). */
export interface ResolvedCommand {
  name: string;
  run: string;
  description?: string;
  params?: Record<string, { type?: string; default?: unknown; description?: string }>;
  emits: "text" | "extract";
}

/** A fully-resolved processor: how the agent (or `direct`) turns one source into
 *  facts, with its skill and identity (for the describe cache key). */
export interface ResolvedProcessor {
  modality: string;
  orchestration: "agent" | "direct";
  commands: ResolvedCommand[];
  skill: ReaderSkill;
  /** Shell template that localizes a remote source into the workdir, if any. */
  fetch?: string;
  /** The package dir for a `path` processor (exposed as `$SMOOTHIE_PROCESSOR_DIR`). */
  processorDir?: string;
  /** Stable identity folded into the describe cache key (spec 10 - caching). */
  identity: string;
}

/** A processor package's self-description (spec 10). Read from `manifest.json`. */
interface ProcessorManifest {
  manifest?: string;
  name?: string;
  version?: string;
  commands?: Array<{
    name: string;
    description?: string;
    run: string;
    params?: Record<string, { type?: string; default?: unknown; description?: string }>;
    emits?: "text" | "extract";
  }>;
}

/** Read a package's `manifest.json` (a built-in or a config `path` package). */
function readPackageManifest(dir: string): ProcessorManifest | null {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ProcessorManifest;
}

/** A manifest's commands as `ResolvedCommand`s (default `emits: "text"`). */
function packageCommands(man: ProcessorManifest | null): ResolvedCommand[] {
  return (man?.commands ?? []).map((c) => ({
    name: c.name, run: c.run, description: c.description, params: c.params, emits: c.emits ?? "text",
  }));
}

/** Glob -> anchored regex (`**` spans path separators, `*` does not). */
function globToRe(p: string): RegExp {
  const esc = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "DBLSTAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DBLSTAR/g, ".*");
  return new RegExp("^" + esc + "$");
}

function uriMatches(pattern: string, uri: string): boolean {
  if (pattern.includes("*")) return globToRe(pattern).test(uri);
  return uri.startsWith(pattern); // scheme/prefix, e.g. "s3://bucket/"
}

/**
 * Resolve a source to a modality name: config `modalities` (declaration order,
 * first match) -> the built-in extension map -> `generic`. Never null - an unknown
 * extension routes to `generic` instead of being silently skipped (spec 10).
 */
export function resolveModality(
  source: { relPath?: string; uri?: string; path?: string },
  modalities: Record<string, ModalityConfig>,
): string {
  const rel = source.relPath ?? (source.path ? path.basename(source.path) : "");
  const uri = source.uri;
  const ext = path.extname(rel || uri || "").slice(1).toLowerCase();

  for (const [name, m] of Object.entries(modalities)) {
    const match = m.match;
    if (!match) continue;
    if (ext && match.ext?.some((e) => e.toLowerCase().replace(/^\./, "") === ext)) return name;
    if (rel && match.glob?.some((g) => globToRe(g).test(rel))) return name;
    if (uri && match.uri && (Array.isArray(match.uri) ? match.uri : [match.uri]).some((u) => uriMatches(u, uri))) return name;
  }
  return classifyModality(rel || uri || "") ?? "generic";
}

/**
 * Resolve the processor for a modality: a config `modalities[<name>]` entry if one
 * exists, else the built-in (bundled toolkit + reader skill) processor.
 */
export function resolveProcessor(
  modality: string,
  ctx: { modalities: Record<string, ModalityConfig>; folder: string },
  bcDir: string,
): ResolvedProcessor {
  const m = ctx.modalities[modality];
  return m
    ? resolveConfigProcessor(modality, m, ctx.folder, bcDir)
    : resolveBuiltinProcessor(modality, bcDir);
}

/** The bundled processor package for a modality (`toolkit/<modality>/`: a
 *  `manifest.json` + co-located `SKILL.md` + the CLI scripts) — a first-class
 *  processor resolved exactly like a config `path` package. Its commands invoke the
 *  scaffolded toolkit via `$SMOOTHIE_TOOLKIT`, so `processorDir` stays unset. */
function resolveBuiltinProcessor(modality: string, bcDir: string): ResolvedProcessor {
  const dir = path.join(bundledToolkitDir(), modality);
  const man = readPackageManifest(dir);
  const commands = packageCommands(man);
  return {
    modality,
    orchestration: "agent",
    commands,
    skill: loadReaderSkill(modality, bcDir), // project override -> package SKILL.md -> generic
    identity: `builtin:${modality}:${man?.version ?? "0"}:${commands.map((c) => c.name).join(",")}`,
  };
}

/** A config-declared modality: build commands from each processor (inline `run`, or
 *  a `path` package's manifest) and resolve its skill by precedence. */
function resolveConfigProcessor(
  modality: string,
  m: ModalityConfig,
  folder: string,
  bcDir: string,
): ResolvedProcessor {
  const orchestration = m.orchestration ?? "agent";
  const commands: ResolvedCommand[] = [];
  let processorDir: string | undefined;

  for (const p of m.processors) {
    if (p.path) {
      const dir = path.resolve(folder, p.path);
      processorDir = dir;
      const man = readPackageManifest(dir);
      if (!man) {
        throw new Error(`processor package "${p.path}" (modality ${modality}) has no manifest.json`);
      }
      commands.push(...packageCommands(man));
    } else if (p.run) {
      commands.push({
        name: p.name,
        run: p.run,
        params: p.params,
        // Inline commands emit facts when the modality is deterministic or the
        // command is explicitly named `extract`; otherwise they render text.
        emits: orchestration === "direct" || p.name === "extract" ? "extract" : "text",
      });
    } else {
      throw new Error(`processor "${p.name}" (modality ${modality}) needs a "run" or "path"`);
    }
  }

  return {
    modality,
    orchestration,
    commands,
    skill: resolveProcessorSkill(modality, m, processorDir, folder, bcDir),
    fetch: m.fetch?.run,
    processorDir,
    identity: `config:${modality}:${JSON.stringify(m.processors)}`,
  };
}

/** Skill precedence (spec 10): processor-bundled -> modality `skill:` override ->
 *  project override (`.smoothie/skills/`) -> bundled -> `generic`. */
function resolveProcessorSkill(
  modality: string,
  m: ModalityConfig,
  processorDir: string | undefined,
  folder: string,
  bcDir: string,
): ReaderSkill {
  if (processorDir) {
    const bundled = loadSkillFromDir(processorDir);
    if (bundled) return bundled;
  }
  if (m.skill) {
    const override = loadSkillFromDir(path.resolve(folder, m.skill));
    if (override) return override;
  }
  return loadReaderSkill(modality, bcDir); // project override -> bundled -> generic
}
