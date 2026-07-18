#!/usr/bin/env node
// `smoothie` — the compiler frontend CLI (spec 01/07). Bundles the `svm` runtime.
//
// Phase 2 ships:
//   smoothie login                 — sign in with your ChatGPT subscription (once)
//   smoothie compile <folder>      — ingest → describe → structure → compile → bc.json
// The REAL model (gpt-5.5 on a ChatGPT subscription / API key) is the default.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, type SmoothieConfig } from "./config.ts";
import { DeterministicModelGateway } from "./model/deterministic.ts";
import type { ModelGateway } from "./model/gateway.ts";

const SCHEMA_VERSION = "ontology.v1";

function resolveSvmBin(): string {
  if (process.env.SVM_BIN) return process.env.SVM_BIN;
  // Default: the workspace-built binary at <repo>/target/{debug,release}/svm.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(here, "..", "..");
  for (const profile of ["release", "debug"]) {
    const cand = path.join(repo, "target", profile, "svm");
    if (fs.existsSync(cand)) return cand;
  }
  return "svm"; // fall back to PATH
}

async function makeGateway(deterministic: boolean, model?: SmoothieConfig["model"]): Promise<ModelGateway> {
  // The REAL model is the default. `--deterministic` selects the model-free CI
  // determinism harness (never a substitute for real extraction).
  if (deterministic) return new DeterministicModelGateway();
  const { RealModelGateway } = await import("./model/real.ts");
  // Pass the config's model block so any provider (not just Pi's login) can be
  // driven with its own key: `default` picks the model, `providers` supplies creds.
  return RealModelGateway.create({ defaultModel: model?.default, providers: model?.providers });
}

/** Where the credential is stored — the dir the compiler's bridge searches. */
function authDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

/** `smoothie login [provider]` — sign in with your ChatGPT subscription (or
 *  another OAuth provider) via Pi, storing the token where compile looks for it.
 *  Defaults to `openai-codex` (ChatGPT Plus/Pro). */
function cmdLogin(argv: string[]): number {
  const provider = argv.find((a) => !a.startsWith("--")) ?? "openai-codex";
  // Resolve Pi's login CLI (dist/cli.js) next to its package entry. The package
  // exposes only an ESM `import` condition, so use the ESM resolver.
  let piCli: string;
  try {
    const entry = fileURLToPath((import.meta as { resolve(s: string): string }).resolve("@earendil-works/pi-ai"));
    piCli = path.join(path.dirname(entry), "cli.js");
  } catch {
    console.error("Could not locate @earendil-works/pi-ai. Reinstall deps (pnpm install).");
    return 1;
  }
  // Run the interactive login with the token dir as CWD so `auth.json` lands
  // where the compiler's bridge will find it from anywhere.
  const dir = authDir();
  fs.mkdirSync(dir, { recursive: true });
  console.error(
    `Signing in to ${provider} (your own account; nothing is sent to Smoothie).\n` +
      `Token will be saved to ${path.join(dir, "auth.json")}\n`,
  );
  const res = spawnSync(process.execPath, [piCli, "login", provider], { stdio: "inherit", cwd: dir });
  if (res.status === 0) {
    console.error(`\n✓ Logged in. \`smoothie compile <folder>\` will now use your subscription.`);
    return 0;
  }
  return res.status ?? 1;
}

/** `smoothie skills install [folder]` — scaffold the bundled processor packages
 *  and copy each package's `SKILL.md` into `<folder>/.smoothie/skills/<modality>/`
 *  as an editable, persistent override (spec 10 · skill precedence). */
async function cmdSkills(argv: string[]): Promise<number> {
  const sub = argv[0];
  const { scaffoldToolkit, bundledToolkitDir } = await import("./agent/toolkit.ts");
  if (sub === "install") {
    const folder = argv.find((a, i) => i > 0 && !a.startsWith("--")) ?? ".";
    const bcDir = path.join(path.resolve(folder), ".smoothie");
    const tools = scaffoldToolkit(bcDir); // packages (scripts + manifest.json + SKILL.md)
    // Copy each package's SKILL.md to .smoothie/skills/<modality>/ — the persistent
    // override the resolver prefers (scaffolded tools/ is overwritten each compile).
    const src = bundledToolkitDir();
    const skillsDest = path.join(bcDir, "skills");
    let n = 0;
    for (const m of fs.readdirSync(src)) {
      const sk = path.join(src, m, "SKILL.md");
      if (fs.existsSync(sk)) {
        fs.mkdirSync(path.join(skillsDest, m), { recursive: true });
        fs.copyFileSync(sk, path.join(skillsDest, m, "SKILL.md"));
        n++;
      }
    }
    console.error(
      `✓ scaffolded processor packages          → ${tools}\n` +
      `✓ copied ${n} editable skill overrides    → ${skillsDest}\n` +
      `  edit skills/<modality>/SKILL.md to override, or tools/<modality>/ (scripts + manifest.json) to tweak commands.`,
    );
    return 0;
  }
  console.error("usage: smoothie skills install [folder]   # scaffold processor packages + skills into <folder>/.smoothie/");
  return sub ? 2 : 0;
}

/** `smoothie preprocess --check <folder>` — a dry-run of processor resolution: for
 *  each source, show the modality it matched, the processor's orchestration, its
 *  skill, and its commands. Parses each `path` package's manifest (throws if absent),
 *  so it surfaces misconfigured modalities before a full compile (spec 10). */
async function cmdPreprocess(argv: string[]): Promise<number> {
  const folder = argv.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: smoothie preprocess --check <folder>");
    return 2;
  }
  const abs = path.resolve(folder);
  const { ingest } = await import("./stages/ingest.ts");
  const { resolveProcessor } = await import("./processors/resolve.ts");
  const ing = ingest(abs);
  const bcDir = path.join(abs, ".smoothie");
  let bad = 0;
  for (const src of ing.sources) {
    try {
      const proc = resolveProcessor(src.kind, { folder: abs, modalities: ing.fanOut.modalities }, bcDir);
      const cmds = proc.commands.map((c) => c.name).join(", ") || "(none — agent uses run_python)";
      console.error(
        `• ${src.relPath}\n    modality=${src.kind}  orchestration=${proc.orchestration}  skill=${proc.skill.name}\n    commands: ${cmds}`,
      );
    } catch (e) {
      bad++;
      console.error(`✗ ${src.relPath} (modality ${src.kind}): ${(e as Error).message}`);
    }
  }
  console.error(bad ? `\n✗ ${bad} source(s) failed to resolve a processor.` : `\n✓ all ${ing.sources.length} source(s) resolve a processor.`);
  return bad ? 1 : 0;
}

/** Load a `.env` file (folder's first, then CWD) into `process.env` so API keys
 *  named by `model.providers.*.api_key_env` live OUTSIDE the git-tracked config.
 *  Existing environment variables win — an already-exported key is not overwritten. */
function loadDotEnv(folder: string): void {
  for (const dir of [folder, process.cwd()]) {
    const file = path.join(dir, ".env");
    if (!fs.existsSync(file)) continue;
    try {
      // Node ≥20.12 parses .env without overwriting already-set vars.
      (process as { loadEnvFile(p: string): void }).loadEnvFile(file);
    } catch { /* malformed .env — ignore; a missing key surfaces as a clear gateway error */ }
  }
}

/** Recursively sort object keys so the written ontology bytes are deterministic. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = canonicalJson((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** `smoothie migrate <folder>` — one-shot bc.json → ontology.json (spec 09 §3). */
async function cmdMigrate(argv: string[]): Promise<number> {
  const folder = argv.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: smoothie migrate <folder>   # convert .smoothie/bc.json → .smoothie/ontology.json");
    return 2;
  }
  const bcDir = path.join(path.resolve(folder), ".smoothie");
  const bcPath = path.join(bcDir, "bc.json");
  if (!fs.existsSync(bcPath)) {
    console.error(`no bc.json at ${bcPath} — nothing to migrate.`);
    return 1;
  }
  const { migrateBcToOntology } = await import("./stages/migrate.ts");
  const bc = JSON.parse(fs.readFileSync(bcPath, "utf8"));
  const ontology = migrateBcToOntology(bc, "0.1.0");
  const ontologyPath = path.join(bcDir, "ontology.json");
  fs.writeFileSync(ontologyPath, JSON.stringify(canonicalJson(ontology), null, 2) + "\n");

  const res = spawnSync(resolveSvmBin(), ["validate", ontologyPath], { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`migrate produced an invalid ontology:\n${res.stderr || res.stdout || ""}`);
    return 1;
  }
  console.error(`✓ migrated ${bcPath} → ${ontologyPath}`);
  return 0;
}

/** `smoothie promote|demote <folder> <logic_unit_id> [--why=...]` — transition a
 *  logic unit observed↔executable (spec 10 §3). Promotion is gated by G8 eligibility. */
async function cmdPromote(argv: string[], isDemote: boolean): Promise<number> {
  const nonFlag = argv.filter((a) => !a.startsWith("--"));
  const folder = nonFlag[0];
  const luId = nonFlag[1];
  if (!folder || !luId) {
    console.error(`usage: smoothie ${isDemote ? "demote" : "promote"} <folder> <logic_unit_id> [--why=...]`);
    return 2;
  }
  const abs = path.resolve(folder);
  const bcDir = path.join(abs, ".smoothie");
  const ontPath = path.join(bcDir, "ontology.json");
  if (!fs.existsSync(ontPath)) {
    console.error(`no ontology.json at ${ontPath}`);
    return 1;
  }
  const ont = JSON.parse(fs.readFileSync(ontPath, "utf8"));
  const whyArg = argv.find((a) => a.startsWith("--why="));
  const why = whyArg ? whyArg.slice("--why=".length) : undefined;

  const { checkEligibility, promote, demote } = await import("./stages/promote.ts");

  if (isDemote) {
    if (!ont.logic_units?.[luId]) {
      console.error(`logic unit ${luId} not found`);
      return 1;
    }
    demote(ont, luId, why);
  } else {
    let min = 0.7;
    let autonomy = { blastSmallMax: 50, judgedPenalty: 1 };
    try {
      const cfg = loadConfig(abs).config;
      min = cfg.promotion?.min_de_facto_support ?? 0.7;
      autonomy = { blastSmallMax: cfg.autonomy?.blast_small_max ?? 50, judgedPenalty: cfg.autonomy?.judged_penalty ?? 1 };
    } catch { /* defaults */ }
    const elig = checkEligibility(ont, luId, min);
    if (!elig.eligible) {
      console.error(`✗ ${luId} is not promotable (G8 eligibility):\n${elig.reasons.map((r) => "  - " + r).join("\n")}`);
      return 1;
    }
    const flag = (name: string): string | undefined => {
      const a = argv.find((x) => x.startsWith(`--${name}=`));
      return a ? a.slice(name.length + 3) : undefined;
    };
    promote(ont, luId, why, {
      disposition: flag("disposition"),
      reversibility: flag("reversibility"),
      blastEntities: flag("blast") ? Number(flag("blast")) : undefined,
      writes: argv.filter((x) => x.startsWith("--write=")).map((x) => x.slice("--write=".length)),
      reads: argv.filter((x) => x.startsWith("--read=")).map((x) => x.slice("--read=".length)),
      autonomy,
    });
  }

  fs.writeFileSync(ontPath, JSON.stringify(canonicalJson(ont), null, 2) + "\n");
  const res = spawnSync(resolveSvmBin(), ["validate", ontPath], { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`${isDemote ? "demote" : "promote"} produced an invalid ontology:\n${res.stderr || res.stdout || ""}`);
    return 1;
  }
  // Best-effort versioned commit (the operation is reversible via the git store).
  if (fs.existsSync(path.join(bcDir, ".git"))) {
    spawnSync("git", ["-C", bcDir, "add", "ontology.json"]);
    spawnSync("git", ["-C", bcDir, "-c", "user.name=Smoothie", "-c", "user.email=smoothie@smoothie.local", "commit", "-q", "-m", `${isDemote ? "demote" : "promote"} ${luId}`, "--", "ontology.json"]);
  }
  console.error(`✓ ${isDemote ? "demoted" : "promoted"} ${luId} → ${ont.logic_units[luId].state}${isDemote ? "" : " (L0 propose-only)"}`);
  return 0;
}

/** `smoothie conformance <folder>` — run the conformance loop (spec 10 §6): measure
 *  each executable logic unit's drift and auto-demote drifted flows to observed. */
async function cmdConformance(argv: string[]): Promise<number> {
  const folder = argv.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: smoothie conformance <folder>");
    return 2;
  }
  const abs = path.resolve(folder);
  const bcDir = path.join(abs, ".smoothie");
  const ontPath = path.join(bcDir, "ontology.json");
  if (!fs.existsSync(ontPath)) {
    console.error(`no ontology.json at ${ontPath}`);
    return 1;
  }
  const ont = JSON.parse(fs.readFileSync(ontPath, "utf8"));
  let cfg = { driftAlert: 0.15, driftMax: 0.35 };
  try {
    const c = loadConfig(abs).config.conformance;
    cfg = { driftAlert: c?.drift_alert ?? 0.15, driftMax: c?.drift_max ?? 0.35 };
  } catch { /* defaults */ }

  const { runConformance } = await import("./stages/conformance.ts");
  const res = runConformance(ont, cfg);
  ont.notes = [...(ont.notes ?? []), ...res.notes];

  fs.writeFileSync(ontPath, JSON.stringify(canonicalJson(ont), null, 2) + "\n");
  const r = spawnSync(resolveSvmBin(), ["validate", ontPath], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`conformance produced an invalid ontology:\n${r.stderr || r.stdout || ""}`);
    return 1;
  }
  if (fs.existsSync(path.join(bcDir, ".git")) && res.notes.length) {
    spawnSync("git", ["-C", bcDir, "add", "ontology.json"]);
    spawnSync("git", ["-C", bcDir, "-c", "user.name=Smoothie", "-c", "user.email=smoothie@smoothie.local", "commit", "-q", "-m", `conformance: -${res.demoted.length} demoted`, "--", "ontology.json"]);
  }
  console.error(`✓ conformance: ${res.demoted.length} demoted${res.demoted.length ? ` (${res.demoted.join(", ")})` : ""}, ${res.alerts.length} alert(s)`);
  return 0;
}

async function cmdCompile(argv: string[]): Promise<number> {
  const deterministic = argv.includes("--deterministic");
  // --full forces a from-scratch recompile (model + resolve re-run over every source)
  // instead of reconciling only new/changed sources into the existing ontology.
  // describe stays cached (keyed by content hash), so only the model stages re-run.
  const full = argv.includes("--full");
  const folder = argv.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: smoothie compile <folder> [--deterministic] [--full]");
    return 2;
  }
  // Bring `.env` keys into the environment before the gateway resolves credentials.
  if (!deterministic) loadDotEnv(path.resolve(folder));

  // Read the config's model block up front so the gateway can wire per-provider
  // credentials (loadConfig is a cheap file read; the pipeline re-reads it too).
  let modelCfg: SmoothieConfig["model"];
  if (!deterministic) {
    try { modelCfg = loadConfig(path.resolve(folder)).config.model; } catch { /* the pipeline surfaces the config error */ }
  }
  const gateway = await makeGateway(deterministic, modelCfg);

  // ingest → describe → model → resolve → compile → ontology.json (spec 00 §4).
  const { runOntologyCompile } = await import("./pipeline-ontology.ts");
  const run = await runOntologyCompile(path.resolve(folder), { gateway, svmBin: resolveSvmBin(), ...(full ? { incremental: false } : {}) });
  console.error(
    `✓ compiled ${folder} → ${run.ontologyPath}\n` +
      `  ontology_id: ${run.ontologyId} · model: ${gateway.kind} · validated: ${run.validated}\n` +
      `  stages: ${run.telemetry.stages.map((s) => `${s.stage}(${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(",")})`).join(" → ")}`,
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  if (cmd === "--version" || cmd === "-v") {
    console.log(`smoothie frontend (targets ${SCHEMA_VERSION})`);
    return 0;
  }
  if (cmd === "login") return cmdLogin(argv.slice(3));
  if (cmd === "skills") return cmdSkills(argv.slice(3));
  if (cmd === "preprocess") return cmdPreprocess(argv.slice(3));
  if (cmd === "compile") return cmdCompile(argv.slice(3));
  if (cmd === "migrate") return cmdMigrate(argv.slice(3));
  if (cmd === "promote") return cmdPromote(argv.slice(3), false);
  if (cmd === "demote") return cmdPromote(argv.slice(3), true);
  if (cmd === "conformance") return cmdConformance(argv.slice(3));
  console.error(
    "smoothie — the multimodal ontology compiler frontend.\n" +
      "  smoothie login                               sign in with your ChatGPT subscription (once)\n" +
      "  smoothie compile <folder> [--deterministic] [--full]  ingest→describe→model→resolve→compile → ontology.json\n" +
      "  smoothie migrate <folder>                    convert an existing .smoothie/bc.json → ontology.json\n" +
      "  smoothie preprocess --check <folder>         dry-run: show each source's resolved processor\n" +
      "  smoothie skills install [folder]             copy built-in reader skills to .smoothie/skills/\n" +
      "  (the bundled `svm` validates and queries the ontology: `svm validate`, `svm ontology`)",
  );
  return cmd ? 2 : 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    // A clean one-line error, not a raw stack trace / unhandled-rejection dump.
    process.stderr.write(`smoothie: ${(e as Error)?.message ?? String(e)}\n`);
    process.exit(1);
  });
