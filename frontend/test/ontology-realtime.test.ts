// Phase 7 gate, part 1 (IMPLEMENTATION.md · Phase 7; spec 09 §6.6): streaming a
// change feed converges to the batch build of the final state. Real-time is
// incremental reconciliation on a faster clock (spec 08 §1), so a scheduler that
// debounces bursts of change events into incremental builds must land on the same
// structural ontology as a cold build of the final corpus.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runOntologyCompile } from "../src/pipeline-ontology.ts";
import { Scheduler } from "../src/connectors/index.ts";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = path.join(HERE, "fixtures/ontology-multi/smoothie_config.yaml");
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

const ALPHA1 = "Alpha division reported strong revenue growth.";
const ALPHA2 = "Alpha division delivered record operating income this year.";
const BETA = "Beta unit expanded overseas manufacturing operations.";
const GAMMA = "Gamma segment posted record quarterly results.";

function emptyCorpus(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-rt-"));
  fs.copyFileSync(CFG, path.join(dir, "smoothie_config.yaml"));
  return dir;
}
const compileOf = (dir: string, opts: Record<string, unknown> = {}) =>
  runOntologyCompile(dir, { gateway: new DeterministicModelGateway(), svmBin: SVM, git: false, ...opts });
const readOnt = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8"));
const idSets = (o: { entities: object; entity_types: object; links: object; resolutions: object }) => ({
  entities: Object.keys(o.entities).sort(),
  entity_types: Object.keys(o.entity_types).sort(),
  links: Object.keys(o.links).sort(),
  resolutions: Object.keys(o.resolutions).sort(),
});

vdescribe("Phase 7 — real-time convergence (streaming == batch)", () => {
  it("a debounced change feed converges to the cold build of the final state", async () => {
    const dir = emptyCorpus();
    const sched = new Scheduler(dir, () => compileOf(dir));

    // Burst 1: alpha appears.
    await sched.pushBurst([{ source_id: "alpha", op: "upsert", path: "alpha.md", content: ALPHA1 }]);
    // Burst 2: beta and gamma appear together.
    await sched.pushBurst([
      { source_id: "beta", op: "upsert", path: "beta.md", content: BETA },
      { source_id: "gamma", op: "upsert", path: "gamma.md", content: GAMMA },
    ]);
    // Burst 3: alpha is edited, beta is deleted.
    const last = await sched.pushBurst([
      { source_id: "alpha", op: "upsert", path: "alpha.md", content: ALPHA2 },
      { source_id: "beta", op: "delete", path: "beta.md" },
    ]);
    expect(last.deletedSourceIds.some((id) => id.includes("beta"))).toBe(true);

    // The batch build of the final corpus state: { alpha(v2), gamma }.
    const cold = emptyCorpus();
    fs.writeFileSync(path.join(cold, "alpha.md"), ALPHA2);
    fs.writeFileSync(path.join(cold, "gamma.md"), GAMMA);
    await compileOf(cold, { incremental: false });

    expect(idSets(readOnt(dir))).toEqual(idSets(readOnt(cold)));
    // Two live entities remain (alpha, gamma); beta was retired on delete.
    expect(Object.keys(readOnt(dir).entities).length).toBe(2);
  });
});
