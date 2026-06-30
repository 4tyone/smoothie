// The modality toolkit — pre-built, sophisticated Python data-processing scripts
// the extraction agent ORCHESTRATES instead of writing extraction from scratch
// (spec 04, toolkit concept). Each script is a self-contained CLI with PEP 723
// inline dependencies, so `uv run <script>` provisions an isolated, cached env per
// script's dependency set (lazy on first use, separated by modality — no shared,
// bloated venv). The agent only writes Python for data-specific glue.
//
// Source of truth: `frontend/src/toolkit/<modality>/*.py`. Scaffolded into the
// project's `.smoothie/tools/` so the agent (and the user) can read and fork them.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The bundled, versioned toolkit (source of truth). */
export function bundledToolkitDir(): string {
  return path.resolve(HERE, "..", "toolkit");
}

/** Scaffold the toolkit into `<bcDir>/tools/` and return that absolute path. The
 *  bundled toolkit is canonical (kept in sync with the installed Smoothie), so this
 *  overwrites; the agent's data-specific edits live in its per-source workdir. */
export function scaffoldToolkit(bcDir: string): string {
  const dest = path.join(bcDir, "tools");
  const src = bundledToolkitDir();
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
  else fs.mkdirSync(dest, { recursive: true });
  return dest;
}

/** The toolkit script filenames available for a modality (for the agent prompt). */
export function toolkitScripts(modality: string): string[] {
  const dir = path.join(bundledToolkitDir(), modality);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".py")).sort();
}
