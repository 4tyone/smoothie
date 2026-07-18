// Phase 11 gate (IMPLEMENTATION.md · Phase 11; spec 10 §9.4): the conformance loop.
// An executable flow's baseline (the steps attested at promotion) is continuously
// checked against the live event stream; when drift crosses drift_max the flow is
// AUTO-DEMOTED to observed (author: system), failing safe rather than executing on
// stale assumptions. Below drift_max it alerts; unchanged, it stays executable.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { checkDrift, runConformance } from "../src/stages/conformance.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

const CFG = { driftAlert: 0.15, driftMax: 0.35 };

/** A valid ontology with one executable logic unit (baseline steps s1, s2) plus
 *  events for those steps and any `extraSteps` (new observations = drift). */
function executableOntology(extraSteps: string[]): Record<string, unknown> {
  const ref = (t0: number) => [{ source_id: "s_log", span: { kind: "time", t_start: t0, t_end: t0 + 1 } }];
  const events: Record<string, unknown> = {
    e1: { event_id: "e1", logic_unit_id: "lu_x", step_id: "s1", source_refs: ref(0) },
    e2: { event_id: "e2", logic_unit_id: "lu_x", step_id: "s2", source_refs: ref(1) },
  };
  extraSteps.forEach((s, i) => {
    events[`ex${i}`] = { event_id: `ex${i}`, logic_unit_id: "lu_x", step_id: s, source_refs: ref(10 + i) };
  });
  return {
    schema: "ontology.v1",
    manifest: { ontology_id: "ont-conf", schema: "ontology.v1", profile: "corpus" },
    sources: { s_log: { source_id: "s_log", kind: "jsonl", hash: "sha256:log" } },
    facts: {},
    entity_types: {},
    entities: {},
    link_types: {},
    links: {},
    resolutions: {},
    events,
    logic_units: {
      lu_x: {
        logic_unit_id: "lu_x",
        name: "Pipeline",
        state: "executable",
        trust_class: "derived",
        steps: [
          { step_id: "s1", text: "a", evidence: [{ class: "de_facto", event_ids: ["e1"] }] },
          { step_id: "s2", text: "b", evidence: [{ class: "de_facto", event_ids: ["e2"] }] },
        ],
        contract: {
          inputs: [],
          outputs: [],
          restrictions: { reads: [], writes: [], forbid: [] },
          reversibility: "reversible",
          blast_radius: { entities: 5 },
          baseline_steps: ["s1", "s2"],
          disposition: { requested: "L3", floor: "L3", effective: "L3" },
        },
      },
    },
    version: { version_id: "v1", envelope: { source_hashes: { s_log: "sha256:log" } }, operations: [] },
  };
}

function writeAndValidate(ont: unknown): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-conf-"));
  const p = path.join(dir, "ontology.json");
  fs.writeFileSync(p, JSON.stringify(ont, null, 2));
  try {
    execFileSync(SVM, ["validate", p]);
    return true;
  } catch {
    return false;
  }
}

vdescribe("Phase 11 — conformance loop (G10)", () => {
  it("no drift when the event stream matches the baseline — flow stays executable", () => {
    const ont = executableOntology([]) as never;
    expect(checkDrift(ont, CFG)[0]).toMatchObject({ luId: "lu_x", drift: 0, action: "none" });
    const res = runConformance(ont, CFG);
    expect(res.demoted).toEqual([]);
    expect((ont as { logic_units: { lu_x: { state: string } } }).logic_units.lu_x.state).toBe("executable");
  });

  it("mild drift raises an alert but does not demote", () => {
    // baseline {s1,s2} vs current {s1,s2,s3} → distance 1/3 ≈ 0.33 (>= alert, < max).
    const ont = executableOntology(["s3"]) as never;
    const res = runConformance(ont, CFG);
    expect(res.alerts).toContain("lu_x");
    expect(res.demoted).toEqual([]);
    expect((ont as { logic_units: { lu_x: { state: string } } }).logic_units.lu_x.state).toBe("executable");
  });

  it("drift beyond drift_max auto-demotes the flow to observed (fails safe)", () => {
    // baseline {s1,s2} vs current {s1,s2,s3,s4} → distance 2/4 = 0.5 (>= max).
    const ont = executableOntology(["s3", "s4"]) as never;
    const item = checkDrift(ont, CFG)[0];
    expect(item.drift).toBeGreaterThanOrEqual(CFG.driftMax);

    const res = runConformance(ont, CFG);
    expect(res.demoted).toEqual(["lu_x"]);

    const lu = (ont as { logic_units: { lu_x: { state: string; contract?: unknown } } }).logic_units.lu_x;
    expect(lu.state).toBe("observed"); // failed safe, no longer executing
    expect(lu.contract).toBeUndefined();

    // The auto-demote is a system-authored, reversible Operation, and it validates.
    const ops = (ont as { version: { operations: Array<{ op: string; author: string }> } }).version.operations;
    expect(ops.some((o) => o.op === "demote" && o.author === "system")).toBe(true);
    expect(writeAndValidate(ont)).toBe(true);
  });
});
