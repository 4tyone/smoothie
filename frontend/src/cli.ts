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
import { runCompile } from "./pipeline.ts";
import { DeterministicModelGateway } from "./model/deterministic.ts";
import type { ModelGateway } from "./model/gateway.ts";

const SCHEMA_VERSION = "bc.v1";

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

async function makeGateway(deterministic: boolean): Promise<ModelGateway> {
  // The REAL model is the default. `--deterministic` selects the model-free CI
  // determinism harness (never a substitute for real extraction).
  if (deterministic) return new DeterministicModelGateway();
  const { RealModelGateway } = await import("./model/real.ts");
  return RealModelGateway.create();
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

async function cmdCompile(argv: string[]): Promise<number> {
  const deterministic = argv.includes("--deterministic");
  const folder = argv.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("usage: smoothie compile <folder> [--deterministic] [--resolve[=name,...]]");
    return 2;
  }
  // --resolve runs the verify stage (promote claimed→confirmed). `--resolve`
  // alone runs the offline Resolvers; `--resolve=cross-source` picks specific ones.
  const resolveArg = argv.find((a) => a === "--resolve" || a.startsWith("--resolve="));
  const resolvers = resolveArg
    ? (resolveArg.includes("=") ? resolveArg.split("=")[1].split(",") : ["re-examine", "cross-source"])
    : undefined;

  const gateway = await makeGateway(deterministic);
  const run = await runCompile(path.resolve(folder), { gateway, svmBin: resolveSvmBin(), resolvers });
  console.error(
    `✓ compiled ${folder} → ${run.bcPath}\n` +
      `  bc_id: ${run.bcId} · model: ${gateway.kind} · validated: ${run.validated}\n` +
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
  console.error(
    "smoothie — the multimodal data compiler frontend.\n" +
      "  smoothie login                               sign in with your ChatGPT subscription (once)\n" +
      "  smoothie compile <folder> [--deterministic]  ingest→describe→structure→compile → bc.json\n" +
      "  smoothie preprocess --check <folder>         dry-run: show each source's resolved processor\n" +
      "  smoothie skills install [folder]             copy built-in reader skills to .smoothie/skills/\n" +
      "  (the bundled `svm` consumes the BC: `svm query`, `svm emit`)",
  );
  return cmd ? 2 : 0;
}

main(process.argv).then((code) => process.exit(code));
