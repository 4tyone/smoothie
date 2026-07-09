// ingest (code, deterministic) — folder → brief + sources (spec 03 · ingest).
//
// The Brief is required and schema-validated; ingest aborts without it. Each file
// is probed and classified by modality, and registered as a source. The Brief's
// fields are fanned out to the BC sections (manifest/brief/policy/glossary).

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { loadConfig, fanOut, CONFIG_FILENAME, type BriefFanOut } from "../config.ts";
import { resolveModality } from "../processors/resolve.ts";

export interface IngestedSource {
  source_id: string;
  kind: string; // modality tag (drives processor resolution)
  path: string; // absolute local path ("" for a not-yet-fetched remote source)
  relPath: string; // relative to the corpus folder (or the URI, for remote sources)
  hash: string;
  uri?: string; // set for remote / explicit sources (spec 10); localized via `fetch`
}

export interface IngestResult {
  folder: string;
  fanOut: BriefFanOut;
  sources: IngestedSource[];
  skipped: string[];
}

function sha256(file: string): string {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
}

/** Hash a string (a remote source's URI stands in for its content in v1). */
function sha256str(s: string): string {
  return "sha256:" + crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Walk a folder (one level + immediate subdirs), classifying each file. */
function listFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(folder);
  return out;
}

/** Parse `.smoothieignore` (gitignore-ish): one pattern per line, `#` comments.
 *  A trailing `/` is a directory prefix; `*` is a wildcard; otherwise exact path
 *  or basename. `.smoothie/` and `smoothie_config.yaml` are always ignored. */
function loadIgnore(folder: string): (rel: string) => boolean {
  const file = path.join(folder, ".smoothieignore");
  const patterns = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
  const toRe = (p: string): RegExp =>
    new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (p.endsWith("/") ? ".*" : "$"));
  const res = patterns.map(toRe);
  return (rel: string) =>
    rel === CONFIG_FILENAME ||
    rel.split("/")[0] === ".smoothie" ||
    res.some((re) => re.test(rel) || re.test(path.basename(rel)));
}

export function ingest(folder: string): IngestResult {
  const { config } = loadConfig(folder);
  const created = process.env.SMOOTHIE_NOW ?? "2026-01-01T00:00:00Z";
  const fan = fanOut(config, created);

  const sources: IngestedSource[] = [];
  const skipped: string[] = [];
  const ignored = loadIgnore(folder);
  // Sanitizing a path to a source_id is lossy (`Report.PDF` and `report.pdf` both
  // → `src-report-pdf`), so distinct sources could silently collapse onto one id —
  // one vanishes and the other inherits its receipts. `mintId` guarantees a stable,
  // unique id per distinct key by appending a short key-hash on collision.
  const used = new Set<string>();
  const mintId = (key: string): string => {
    const base = "src-" + key.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    if (!used.has(base)) { used.add(base); return base; }
    // Deterministic disambiguator from the full key (stable across runs).
    const suffix = crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
    const id = `${base}-${suffix}`;
    used.add(id);
    return id;
  };

  for (const file of listFiles(folder)) {
    const rel = path.relative(folder, file);
    if (ignored(rel)) continue; // smoothie_config.yaml, .smoothie/, and .smoothieignore patterns
    // Config modalities (first match) → built-in extension map → `generic` (spec 10):
    // an unknown extension routes to `generic` instead of being silently skipped.
    const kind = resolveModality({ relPath: rel }, fan.modalities);
    // Stable, content-independent source_id so re-runs match (spec 03 determinism).
    const source_id = mintId(rel);
    sources.push({ source_id, kind, path: file, relPath: rel, hash: sha256(file) });
  }

  // Remote / explicit source declarations (spec 10): registered alongside files and
  // localized by their modality's `fetch` step at describe time.
  for (const decl of fan.sourceDecls) {
    const source_id = mintId(decl.uri);
    sources.push({ source_id, kind: decl.modality, path: "", relPath: decl.uri, hash: sha256str(decl.uri), uri: decl.uri });
  }

  // Deterministic ordering by source_id.
  sources.sort((a, b) => a.source_id.localeCompare(b.source_id));
  return { folder, fanOut: fan, sources, skipped };
}
