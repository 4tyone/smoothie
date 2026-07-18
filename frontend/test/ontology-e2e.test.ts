// Phase 2 gate (IMPLEMENTATION.md · Phase 2; spec 09 §6.1): the ontology track
// ingest → describe → model → compile produces a valid `ontology.json`, and the
// cat_case_study segment rename resolves to a SINGLE `Segment` entity carrying both
// surface names as aliases (spec 01 §5.2, spec 07 §1). Uses the deterministic
// gateway so "same input → same ontology" is asserted without a live model.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runOntologyCompile } from "../src/pipeline-ontology.ts";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENAME = path.join(HERE, "fixtures/ontology-rename");
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

function copyDir(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-ont-"));
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  return dir;
}

async function compileOntologyDet(folder: string) {
  return runOntologyCompile(folder, { gateway: new DeterministicModelGateway(), svmBin: SVM });
}

interface Ont {
  entities: Record<string, { type_id: string; label: string; aliases: Array<{ text: string; source_id: string }> }>;
  entity_types: Record<string, { name: string }>;
}
const readOnt = (folder: string): Ont =>
  JSON.parse(fs.readFileSync(path.join(folder, ".smoothie/ontology.json"), "utf8"));

vdescribe("Phase 2 — ontology track (model → compile)", () => {
  it("produces an ontology the SVM validates (gates G1-G7 hold on produced data)", async () => {
    const dir = copyDir(RENAME);
    const run = await compileOntologyDet(dir);
    expect(run.validated).toBe(true);
    execFileSync(SVM, ["validate", run.ontologyPath]); // throws on non-zero
  });

  it("the segment rename resolves to ONE Segment entity with both aliases (the acceptance test)", async () => {
    const dir = copyDir(RENAME);
    await compileOntologyDet(dir);
    const ont = readOnt(dir);

    const segments = Object.values(ont.entities).filter((e) => ont.entity_types[e.type_id]?.name === "Segment");
    expect(segments.length).toBe(1);

    const aliasTexts = segments[0].aliases.map((a) => a.text).sort();
    expect(aliasTexts).toContain("Energy & Transportation");
    expect(aliasTexts).toContain("Power & Energy");
    // The two surface names came from two different sources (cross-source resolution).
    const aliasSources = new Set(segments[0].aliases.map((a) => a.source_id));
    expect(aliasSources.size).toBe(2);
  });

  it("is deterministic — same input → byte-identical ontology.json", async () => {
    const a = copyDir(RENAME);
    const b = copyDir(RENAME);
    await compileOntologyDet(a);
    await compileOntologyDet(b);
    const ontA = fs.readFileSync(path.join(a, ".smoothie/ontology.json"), "utf8");
    const ontB = fs.readFileSync(path.join(b, ".smoothie/ontology.json"), "utf8");
    expect(ontA).toBe(ontB);
  });

  it("the compile telemetry reconstructs the pipeline: ingest → describe → model → resolve → feedback → compile", async () => {
    const dir = copyDir(RENAME);
    const run = await compileOntologyDet(dir);
    expect(run.telemetry.stages.map((s) => s.stage)).toEqual(["ingest", "describe", "model", "resolve", "feedback", "compile"]);
  });
});
