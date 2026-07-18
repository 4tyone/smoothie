// Phase 4 gate (IMPLEMENTATION.md · Phase 4; spec 09 §4/§6.3): the four determinism
// tests for an emergent-but-stable schema — structural-stability, incremental-
// equivalence, and reversibility (rollback) — plus the bc→ontology migration. Uses
// the deterministic gateway so the guarantees are asserted without a live model.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runOntologyCompile } from "../src/pipeline-ontology.ts";
import { migrateBcToOntology } from "../src/stages/migrate.ts";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MULTI = path.join(HERE, "fixtures/ontology-multi");
const GOLDEN_BC = path.join(HERE, "fixtures/golden/bc.json");
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

/** A temp corpus with the fixture config plus a chosen subset of its .md sources. */
function corpusWith(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-inc-"));
  fs.copyFileSync(path.join(MULTI, "smoothie_config.yaml"), path.join(dir, "smoothie_config.yaml"));
  for (const f of files) fs.copyFileSync(path.join(MULTI, f), path.join(dir, f));
  return dir;
}

const gw = () => new DeterministicModelGateway();
const compile = (dir: string, opts: Record<string, unknown> = {}) =>
  runOntologyCompile(dir, { gateway: gw(), svmBin: SVM, ...opts });
const readOnt = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8"));
const idSets = (o: { entities: object; entity_types: object; links: object; resolutions: object }) => ({
  entities: Object.keys(o.entities).sort(),
  entity_types: Object.keys(o.entity_types).sort(),
  links: Object.keys(o.links).sort(),
  resolutions: Object.keys(o.resolutions).sort(),
});

vdescribe("Phase 4 — reconciliation, incremental stability, reversibility", () => {
  it("structural-stability — same corpus, two cold builds → byte-identical + same id sets", async () => {
    const a = corpusWith(["alpha.md", "beta.md", "gamma.md"]);
    const b = corpusWith(["alpha.md", "beta.md", "gamma.md"]);
    await compile(a, { incremental: false, git: false });
    await compile(b, { incremental: false, git: false });
    const ontA = fs.readFileSync(path.join(a, ".smoothie/ontology.json"), "utf8");
    const ontB = fs.readFileSync(path.join(b, ".smoothie/ontology.json"), "utf8");
    expect(ontA).toBe(ontB);
    expect(idSets(readOnt(a))).toEqual(idSets(readOnt(b)));
  });

  it("incremental-equivalence — cold {a,b,c} == a, then +b, then +c (same structural set)", async () => {
    const cold = corpusWith(["alpha.md", "beta.md", "gamma.md"]);
    await compile(cold, { incremental: false, git: false });

    const inc = corpusWith(["alpha.md"]);
    await compile(inc, { git: false }); // cold first build (a)
    fs.copyFileSync(path.join(MULTI, "beta.md"), path.join(inc, "beta.md"));
    const r2 = await compile(inc, { git: false }); // incremental +b
    expect(r2.newSourceCount).toBe(1);
    fs.copyFileSync(path.join(MULTI, "gamma.md"), path.join(inc, "gamma.md"));
    const r3 = await compile(inc, { git: false }); // incremental +c
    expect(r3.newSourceCount).toBe(1);

    expect(idSets(readOnt(inc))).toEqual(idSets(readOnt(cold)));
    // Three distinct, un-mergeable entities emerged (no false resolution).
    expect(Object.keys(readOnt(cold).entities).length).toBe(3);
  });

  it("carries unchanged facts forward and re-describes only new sources", async () => {
    const dir = corpusWith(["alpha.md"]);
    await compile(dir, { git: false });
    fs.copyFileSync(path.join(MULTI, "beta.md"), path.join(dir, "beta.md"));
    const run = await compile(dir, { git: false });
    const describe = run.telemetry.stages.find((s) => s.stage === "describe");
    expect(describe?.counts).toMatchObject({ new: 1, carried: 1, facts: 2 });
  });

  it("reversibility — build N, then git rollback restores the prior ontology exactly", async () => {
    const dir = corpusWith(["alpha.md", "beta.md"]);
    await compile(dir); // v1 = {a,b}, committed
    const v1 = fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8");

    fs.copyFileSync(path.join(MULTI, "gamma.md"), path.join(dir, "gamma.md"));
    await compile(dir); // v2 = {a,b,c}, committed
    const v2 = fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8");
    expect(v2).not.toBe(v1);

    // Roll the versioned store back one commit → ontology.json is restored exactly.
    execFileSync("git", ["reset", "--hard", "HEAD~1"], { cwd: path.join(dir, ".smoothie") });
    const rolledBack = fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8");
    expect(rolledBack).toBe(v1);
  });

  it("migrate — a bc.v1 BC converts to a valid ontology.v1 the SVM accepts", () => {
    const bc = JSON.parse(fs.readFileSync(GOLDEN_BC, "utf8"));
    const ontology = migrateBcToOntology(bc, "0.1.0");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-mig-"));
    const ontologyPath = path.join(dir, "ontology.json");
    fs.writeFileSync(ontologyPath, JSON.stringify(ontology, null, 2) + "\n");
    execFileSync(SVM, ["validate", ontologyPath]); // throws on non-zero
  });
});
