// Phase 2 test gate (PHASES · Phase 2): a real source → a valid BC that the
// Phase-1 SVM consumes and serves (query + emit). The default compile uses the
// REAL model (gpt-5.5 on the user's ChatGPT subscription / API key); this suite
// uses the deterministic harness so it can assert "same input → same BC" in CI
// without a non-deterministic model — it tests the plumbing, not model quality.

import { describe as vdescribe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runCompile } from "../src/pipeline.ts";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";

import { ingest } from "../src/stages/ingest.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "fixtures/corpus");
const MULTI = path.join(HERE, "fixtures/multi");
const MIXED = path.join(HERE, "fixtures/mixed");
const CORROBORATED = path.join(HERE, "fixtures/corroborated");
const GOLDEN = path.join(HERE, "fixtures/golden/bc.json");
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

function copyDir(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-e2e-"));
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  return dir;
}
const freshCorpus = () => copyDir(CORPUS);

async function compileDeterministic(folder: string) {
  return runCompile(folder, { gateway: new DeterministicModelGateway(), svmBin: SVM });
}

function readBc(folder: string): { graph: { nodes: Record<string, unknown>; edges: Array<{ fidelity: string }> } } {
  return JSON.parse(fs.readFileSync(path.join(folder, ".smoothie/bc.json"), "utf8"));
}

vdescribe("Phase 2 — producer → contract → consumer", () => {
  let bcPath: string;

  beforeAll(async () => {
    const dir = freshCorpus();
    const run = await compileDeterministic(dir);
    bcPath = run.bcPath;
    expect(run.validated).toBe(true);
  });

  it("produces a BC the SVM validates (provenance gates hold on produced data)", () => {
    execFileSync(SVM, ["validate", bcPath]); // throws on non-zero
  });

  it("the SVM serves query/traverse over the produced BC", () => {
    const nodes = JSON.parse(execFileSync(SVM, ["query", "nodes", "--bc", bcPath, "--json"], { encoding: "utf8" }));
    expect(nodes.length).toBeGreaterThan(0);
    const outline = JSON.parse(execFileSync(SVM, ["query", "outline", "o-dunning", "--bc", bcPath, "--json"], { encoding: "utf8" }));
    expect(outline.scenes.length).toBe(1);
  });

  it("the SVM emits a guardrailed test for the web-app profile (0 denials)", () => {
    const report = JSON.parse(
      execFileSync(SVM, ["emit", "test", "--outline", "o-dunning", "--bc", bcPath, "--mode", "read-only", "--stdout", "--json"], { encoding: "utf8" }),
    );
    expect(report.deny).toBe(0);
    expect(report.allow).toBeGreaterThan(0);
  });

  it("is deterministic — same input → byte-identical BC (matches the golden)", async () => {
    const a = freshCorpus();
    const b = freshCorpus();
    await compileDeterministic(a);
    await compileDeterministic(b);
    const bcA = fs.readFileSync(path.join(a, ".smoothie/bc.json"), "utf8");
    const bcB = fs.readFileSync(path.join(b, ".smoothie/bc.json"), "utf8");
    expect(bcA).toBe(bcB);
    expect(bcA).toBe(fs.readFileSync(GOLDEN, "utf8")); // no silent drift from the recorded golden
  });

  it("ingest aborts when the required smoothie_config.yaml is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-noconfig-"));
    fs.writeFileSync(path.join(dir, "doc.md"), "# x\nbody");
    expect(() => ingest(dir)).toThrow(/smoothie_config\.yaml/);
  });

  it("ingest aborts on an invalid smoothie_config.yaml (schema-validated)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-badconfig-"));
    fs.writeFileSync(path.join(dir, "smoothie_config.yaml"), "version: smoothie.config.v1\nprofile: web-app\n"); // missing brief{intent,goals}
    fs.writeFileSync(path.join(dir, "doc.md"), "# x\nbody");
    expect(() => ingest(dir)).toThrow(/validation/);
  });

  it("ingest honors .smoothieignore (auxiliary folders are not ingested as sources)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-ignore-"));
    fs.writeFileSync(path.join(dir, "smoothie_config.yaml"), "version: smoothie.config.v1\nprofile: corpus\nbrief:\n  intent: x\n  goals:\n    - id: g\n      text: t\n");
    fs.writeFileSync(path.join(dir, "data.json"), '{"a":1}');
    fs.mkdirSync(path.join(dir, "reports"));
    fs.writeFileSync(path.join(dir, "reports", "notes.md"), "# notes\nmine");
    fs.writeFileSync(path.join(dir, ".smoothieignore"), "reports/\n");
    const ids = ingest(dir).sources.map((s) => s.relPath);
    expect(ids).toEqual(["data.json"]); // reports/notes.md excluded
  });
});

vdescribe("Phase 5 — resolving (confirmed fidelity)", () => {
  type Node = { fidelity: string; source_refs: Array<{ span: { kind: string } }>; checks: unknown[] };
  const nodesOf = (dir: string) =>
    Object.values(readBc(dir).graph.nodes) as unknown as Node[];

  async function resolveRun(dir: string, resolvers: string[]) {
    return runCompile(dir, { gateway: new DeterministicModelGateway(), svmBin: SVM, resolvers });
  }

  it("cross-source corroboration promotes claimed→confirmed IN PLACE with receipts + checks", async () => {
    const dir = copyDir(CORROBORATED);
    await compileDeterministic(dir); // cold: everything claimed
    expect(nodesOf(dir).every((n) => n.fidelity !== "confirmed")).toBe(true);

    // Re-enter resolve only (no new sources) → promote in place.
    const run = await resolveRun(dir, ["cross-source"]);
    expect(run.newSourceCount).toBe(0);

    const after = nodesOf(dir);
    const confirmed = after.filter((n) => n.fidelity === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    // Every confirmed node carries a real resolution receipt + an evaluated check.
    for (const n of confirmed) {
      expect(n.source_refs.some((r) => r.span.kind === "resolve")).toBe(true);
      expect(n.checks.length).toBeGreaterThan(0);
    }
    // Honest: uncorroborated nodes stay claimed; nothing faked up.
    expect(after.some((n) => n.fidelity === "claimed")).toBe(true);
    // The SVM accepts the confirmed BC (the honest-fidelity gate passes).
    execFileSync(SVM, ["validate", path.join(dir, ".smoothie/bc.json")]);
  });

  it("re-running resolve is idempotent (already-confirmed nodes are not re-resolved)", async () => {
    const dir = copyDir(CORROBORATED);
    await compileDeterministic(dir);
    await resolveRun(dir, ["cross-source"]);
    const first = JSON.stringify(readBc(dir).graph.nodes);
    await resolveRun(dir, ["cross-source"]);
    expect(JSON.stringify(readBc(dir).graph.nodes)).toBe(first);
  });

  it("leaves the web-app profile at claimed — only the live DOM confirms it", async () => {
    const dir = copyDir(MULTI); // web-app profile
    await resolveRun(dir, ["cross-source", "re-examine"]);
    expect(nodesOf(dir).some((n) => n.fidelity === "confirmed")).toBe(false);
  });
});

vdescribe("Phase 4 — full multimodal v1 (resolve no-ops)", () => {
  it("compiles four modalities (md · html · json · notebook) into one valid BC", async () => {
    const dir = copyDir(MIXED);
    const run = await compileDeterministic(dir);
    expect(run.validated).toBe(true);
    const bc = JSON.parse(fs.readFileSync(path.join(dir, ".smoothie/bc.json"), "utf8"));
    const kinds = new Set(Object.values(bc.sources).map((s) => (s as { kind: string }).kind));
    expect([...kinds].sort()).toEqual(["html", "json", "markdown", "notebook"]);
    // resolve is a no-op in v1 → everything stays honest at claimed/guessed.
    const fids = new Set(Object.values(bc.graph.nodes).map((n) => (n as { fidelity: string }).fidelity));
    expect(fids.has("confirmed")).toBe(false);
    // telemetry reconstructs the run: ingest→describe→structure→link→resolve→compile.
    const tel = JSON.parse(fs.readFileSync(path.join(dir, ".smoothie/telemetry.json"), "utf8"));
    expect(tel.stages.map((s: { stage: string }) => s.stage)).toEqual(["ingest", "describe", "structure", "link", "resolve", "compile"]);
  });
});

vdescribe("Phase 3 — link & incremental", () => {
  it("links many mixed-modality sources into ONE connected graph", async () => {
    const dir = copyDir(MULTI); // markdown + csv
    const run = await compileDeterministic(dir);
    expect(run.validated).toBe(true);
    const bc = readBc(dir);
    // Downstream is modality-blind: both readers contributed nodes.
    const ids = Object.keys(bc.graph.nodes);
    expect(ids.some((id) => id.includes("billing-md"))).toBe(true);
    expect(ids.some((id) => id.includes("invoices-csv"))).toBe(true);
    // The connection thesis: at least one cross-source induced edge, `guessed`.
    const induced = bc.graph.edges.filter((e) => e.fidelity === "guessed");
    expect(induced.length).toBeGreaterThan(0);
  });

  it("incrementally adds a source WITHOUT rewriting existing nodes (git diff proves it)", async () => {
    const dir = copyDir(MULTI);
    await compileDeterministic(dir); // initial 2-source compile (committed to git)
    const before = readBc(dir).graph.nodes;

    // Add a third source and re-compile (auto-incremental).
    fs.writeFileSync(path.join(dir, "accounts.md"), "# Account settings\nUsers manage payment methods here.");
    const run = await compileDeterministic(dir);
    expect(run.newSourceCount).toBe(1);
    expect(run.carriedOverNodes).toBe(Object.keys(before).length);

    const after = readBc(dir).graph.nodes;
    // Every previously-existing node is byte-identical; new nodes were added.
    for (const id of Object.keys(before)) {
      expect(JSON.stringify(after[id])).toBe(JSON.stringify(before[id]));
    }
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);

    // git proves it: no existing node *definition* was removed (only additions).
    // (A node definition is a key line `"n-...": {`; references in outlines/edges
    // may legitimately gain the new node, so we match definition lines only.)
    const diff = execFileSync("git", ["-C", path.join(dir, ".smoothie"), "diff", "HEAD~1", "HEAD", "--", "bc.json"], { encoding: "utf8" });
    const removedNodeDefs = diff.split("\n").filter((l) => /^-\s*"n-src-(billing|invoices)[^"]*":\s*\{/.test(l));
    expect(removedNodeDefs).toEqual([]);
    expect(diff).toMatch(/^\+.*"n-src-accounts/m); // the new node was added
  });
});
