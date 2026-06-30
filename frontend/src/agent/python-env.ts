// A managed Python environment for the extraction agent (spec 04, new concept).
// Python is the best language for data engineering, so `describe` lets the agent
// write and run Python to squeeze meaningful data out of any source. We provision
// one shared venv (via `uv`, fast) with the common data libraries, once.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Libraries the agent can rely on across modalities. */
const LIBS = [
  "pdfplumber", "pymupdf", "pandas", "openpyxl", "beautifulsoup4", "lxml",
  "pillow", "nbformat", "html2text", "python-pptx", "tabulate",
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VENV_DIR = process.env.SMOOTHIE_PYENV ?? path.join(REPO_ROOT, ".smoothie-pyenv");
const MARKER = path.join(VENV_DIR, ".provisioned");

function uv(args: string[]): void {
  const bin = process.env.SMOOTHIE_UV ?? "uv";
  execFileSync(bin, args, { stdio: "inherit" });
}

let cachedPython: string | null = null;

/** Ensure the venv exists (provision once) and return its python executable. */
export function ensurePythonEnv(): string {
  const python = path.join(VENV_DIR, "bin", "python");
  if (cachedPython) return cachedPython;
  if (fs.existsSync(MARKER) && fs.existsSync(python)) {
    cachedPython = python;
    return python;
  }
  // First run: create the venv and install the data libraries.
  console.error(`smoothie: provisioning Python env at ${VENV_DIR} (first run; uv)…`);
  uv(["venv", VENV_DIR]);
  uv(["pip", "install", "--python", python, ...LIBS]);
  fs.writeFileSync(MARKER, `provisioned ${LIBS.join(" ")}\n`);
  cachedPython = python;
  return python;
}
