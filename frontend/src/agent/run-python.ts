// The extraction agent's execution tools (spec 04). Two tools, one per source's
// working directory:
//   • run_command — run a shell command (chiefly `uv run <toolkit script>`, ffmpeg,
//     ffprobe). This is how the agent ORCHESTRATES the pre-built modality toolkit:
//     each toolkit script is a PEP 723 inline-deps CLI, so `uv run` provisions an
//     isolated, cached env per script (lazy, separated by modality).
//   • run_python — write+run ad-hoc Python for data-specific glue the toolkit does
//     not cover, in the shared data venv.
//
// Both run in a per-source cwd with `SMOOTHIE_TOOLKIT` set to the project's
// `.smoothie/tools` directory, a wall-clock timeout, and truncated output. This is
// the producer side: the agent runs only on the author's machine over the author's
// own data (spec 06 · author trust).

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ensurePythonEnv } from "./python-env.ts";
import type { AgentTool } from "../model/gateway.ts";
import { Type } from "@earendil-works/pi-ai";

const TIMEOUT_MS = Number(process.env.SMOOTHIE_PY_TIMEOUT_MS ?? "600000");
const MAX_OUTPUT = 30000;

function envFor(toolkitDir?: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = toolkitDir ? { ...process.env, SMOOTHIE_TOOLKIT: toolkitDir } : { ...process.env };
  return extra ? { ...base, ...extra } : base;
}

/** Append each tool invocation to `_calls.log` in the workdir — a readable trace of
 *  exactly what the agent ran (toolkit scripts, ffmpeg, ad-hoc Python). */
function logCall(workDir: string, kind: string, body: string): void {
  try {
    fs.appendFileSync(path.join(workDir, "_calls.log"), `\n## ${kind}\n${body}\n`);
  } catch { /* non-fatal */ }
}

/** Run one shell command in `workDir`; return combined stdout+stderr (truncated). */
export function runCommand(command: string, workDir: string, toolkitDir?: string, extraEnv?: Record<string, string>): string {
  fs.mkdirSync(workDir, { recursive: true });
  logCall(workDir, "run_command", command);
  try {
    const out = execFileSync("/bin/sh", ["-c", command], {
      cwd: workDir,
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: envFor(toolkitDir, extraEnv),
    });
    return truncate(out || "(no output)");
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return truncate(`ERROR:\n${err.stderr ?? ""}${err.stdout ?? ""}${err.message ?? ""}`);
  }
}

/** Run one Python snippet in `workDir`; return combined stdout+stderr (truncated). */
export function runPython(code: string, workDir: string, toolkitDir?: string, extraEnv?: Record<string, string>): string {
  const python = ensurePythonEnv();
  fs.mkdirSync(workDir, { recursive: true });
  logCall(workDir, "run_python", code);
  const scriptPath = path.join(workDir, "_smoothie_step.py");
  fs.writeFileSync(scriptPath, code);
  try {
    const out = execFileSync(python, [scriptPath], {
      cwd: workDir,
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: envFor(toolkitDir, extraEnv),
    });
    return truncate(out || "(no output)");
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return truncate(`ERROR:\n${err.stderr ?? ""}${err.stdout ?? ""}${err.message ?? ""}`);
  }
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

/** The `run_command` tool — run a toolkit script (or ffmpeg/ffprobe/etc.). The
 *  toolkit lives at `$SMOOTHIE_TOOLKIT/<modality>/`; invoke a script with
 *  `uv run "$SMOOTHIE_TOOLKIT/<modality>/<script>.py" <args>`. */
export function commandTool(workDir: string, toolkitDir: string, extraEnv?: Record<string, string>): AgentTool {
  return {
    name: "run_command",
    description:
      "Run a shell command in the source's working directory and return its stdout/stderr. " +
      "PRIMARY USE: run this modality's processor commands (listed in the task). The source is " +
      "at $SMOOTHIE_SOURCE_PATH; bundled toolkit scripts are under $SMOOTHIE_TOOLKIT and a " +
      "processor package (if any) at $SMOOTHIE_PROCESSOR_DIR. Run a command multiple times with " +
      "different args to navigate the source. Prefer processor commands over writing extraction code.",
    parameters: Type.Object({
      command: Type.String({ description: "the shell command to run (e.g. uv run \"$SMOOTHIE_TOOLKIT/video/probe.py\" \"$SMOOTHIE_SOURCE_PATH\" --json)" }),
      purpose: Type.Optional(Type.String({ description: "what this step extracts" })),
    }),
    async run(args: Record<string, unknown>): Promise<string> {
      const command = String(args.command ?? "");
      if (!command.trim()) return "ERROR: empty command";
      return runCommand(command, workDir, toolkitDir, extraEnv);
    },
  };
}

/** Build the `run_python` agent tool bound to a source's working directory. For
 *  data-specific glue the toolkit does not cover. */
export function pythonTool(workDir: string, toolkitDir?: string, extraEnv?: Record<string, string>): AgentTool {
  return {
    name: "run_python",
    description:
      "Run ad-hoc Python 3 in the source's working directory and return its stdout/stderr. " +
      "Use this only for data-specific glue the toolkit does not cover (custom parsing, reshaping a " +
      "toolkit's JSON, combining results). For standard extraction, prefer run_command with a toolkit " +
      "script. Libraries available: pdfplumber, fitz (PyMuPDF), pandas, openpyxl, bs4, PIL, nbformat. " +
      "Print everything meaningful you extract. You may call this multiple times.",
    parameters: Type.Object({
      code: Type.String({ description: "the Python 3 source to run" }),
      purpose: Type.Optional(Type.String({ description: "what this step extracts" })),
    }),
    async run(args: Record<string, unknown>): Promise<string> {
      const code = String(args.code ?? "");
      if (!code.trim()) return "ERROR: empty code";
      return runPython(code, workDir, toolkitDir, extraEnv);
    },
  };
}
