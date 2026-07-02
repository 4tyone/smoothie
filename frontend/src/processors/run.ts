// Running processors (spec 10) - the invocation protocol: env-in, stdout-out.
//
// Each command runs as a subprocess in the source's workdir with the SMOOTHIE_*
// **source descriptor** in the environment. A `text` command's stdout is read by
// the agent; an `extract` command prints a `smoothie.extraction.v1` envelope that
// code validates and materializes provenance for. Every command is a fresh,
// stateless subprocess (the source is on disk).

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as v from "valibot";
import { ExtractionEnvelope } from "../bc/schemas.ts";
import type { ResolvedCommand, ResolvedProcessor } from "./resolve.ts";

const TIMEOUT_MS = Number(process.env.SMOOTHIE_PY_TIMEOUT_MS ?? "600000");

/** The source descriptor a processor is invoked with. */
export interface SourceDescriptor {
  source_id: string;
  /** Workdir-relative path to the source (cwd is the workdir). */
  path: string;
  uri?: string;
  modality: string;
  /** Absolute working directory (cwd + where companions are written). */
  workdir: string;
  toolkitDir: string;
  processorDir?: string;
  briefJson?: string;
}

/** The SMOOTHIE_* environment additions for a command (merged over process.env by
 *  the caller). Params are exposed both as `$name` and `SMOOTHIE_PARAM_<NAME>`. */
export function processorEnv(desc: SourceDescriptor, params: Record<string, unknown> = {}): Record<string, string> {
  const env: Record<string, string> = {
    SMOOTHIE_SOURCE_PATH: desc.path,
    SMOOTHIE_SOURCE_URI: desc.uri ?? `file://${path.resolve(desc.workdir, desc.path)}`,
    SMOOTHIE_SOURCE_ID: desc.source_id,
    SMOOTHIE_SOURCE_BASENAME: path.basename(desc.path),
    SMOOTHIE_MODALITY: desc.modality,
    SMOOTHIE_WORKDIR: desc.workdir,
    SMOOTHIE_TOOLKIT: desc.toolkitDir,
    SMOOTHIE_PARAMS: JSON.stringify(params),
  };
  if (desc.processorDir) env.SMOOTHIE_PROCESSOR_DIR = desc.processorDir;
  if (desc.briefJson) env.SMOOTHIE_BRIEF = desc.briefJson;
  for (const [k, val] of Object.entries(params)) {
    const s = typeof val === "string" ? val : JSON.stringify(val);
    env[k] = s;
    env[`SMOOTHIE_PARAM_${k.toUpperCase()}`] = s;
  }
  return env;
}

/** A command's default param values (used by `direct`; the agent sets its own). */
function paramDefaults(cmd: ResolvedCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(cmd.params ?? {})) if (spec.default !== undefined) out[k] = spec.default;
  return out;
}

/** Run one shell command in the workdir; return combined stdout/stderr. */
export function runShell(
  command: string,
  desc: SourceDescriptor,
  params?: Record<string, unknown>,
): { ok: boolean; out: string } {
  fs.mkdirSync(desc.workdir, { recursive: true });
  try {
    const out = execFileSync("/bin/sh", ["-c", command], {
      cwd: desc.workdir,
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...processorEnv(desc, params) },
    });
    return { ok: true, out: out || "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}` };
  }
}

/** Localize a remote source into the workdir via the modality's `fetch` step. */
export function runFetch(proc: ResolvedProcessor, desc: SourceDescriptor): void {
  if (!proc.fetch) return;
  const r = runShell(proc.fetch, desc);
  if (!r.ok) throw new Error(`fetch failed for ${desc.source_id}: ${r.out.slice(0, 500)}`);
}

/** Run every `extract` command and parse+validate its envelope (the `direct` path). */
export function runExtract(proc: ResolvedProcessor, desc: SourceDescriptor): ExtractionEnvelope[] {
  const extractCmds = proc.commands.filter((c) => c.emits === "extract");
  if (extractCmds.length === 0) {
    throw new Error(`modality "${proc.modality}" is orchestration=direct but declares no extract command`);
  }
  const envelopes: ExtractionEnvelope[] = [];
  for (const cmd of extractCmds) {
    const r = runShell(cmd.run, desc, paramDefaults(cmd));
    if (!r.ok) throw new Error(`processor ${proc.modality}/${cmd.name} failed: ${r.out.slice(0, 500)}`);
    let json: unknown;
    try {
      json = JSON.parse(extractJsonObject(r.out));
    } catch (e) {
      throw new Error(`processor ${proc.modality}/${cmd.name} did not print valid JSON: ${(e as Error).message}`);
    }
    envelopes.push(v.parse(ExtractionEnvelope, json));
  }
  return envelopes;
}

/** The outermost JSON object in a command's stdout (tolerates leading log lines). */
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
