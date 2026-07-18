// Phase 9 gate (IMPLEMENTATION.md · Phase 9; spec 10 §9.2): the promote/demote
// operation and eligibility gate G8. A logic unit whose step is attested only by an
// SOP (never in the logs) is refused promotion; a fully de-facto-attested one
// promotes to executable (L0 propose-only) and validates; a forced bad promotion is
// caught by the standing G8 gate; demote reverses it.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { checkEligibility, promote, demote, deriveFloor, type PromoteOntology } from "../src/stages/promote.ts";

const CFG = { blastSmallMax: 50, judgedPenalty: 1 };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

/** A minimal, svm-valid ontology with one promotable logic unit (lu_ok, every step
 *  de-facto-attested) and one with a fiction step (lu_fiction, step2 is SOP-only). */
function validOntology(): PromoteOntology & Record<string, unknown> {
  const ref = (t0: number) => [{ source_id: "s_log", span: { kind: "time", t_start: t0, t_end: t0 + 1 } }];
  return {
    schema: "ontology.v1",
    manifest: { ontology_id: "ont-verb", schema: "ontology.v1", profile: "corpus" },
    sources: { s_log: { source_id: "s_log", kind: "jsonl", hash: "sha256:log" }, s_sop: { source_id: "s_sop", kind: "markdown", hash: "sha256:sop" } },
    facts: {},
    entity_types: {},
    entities: {},
    link_types: {},
    links: {},
    resolutions: {},
    events: {
      e1: { event_id: "e1", logic_unit_id: "lu_ok", step_id: "s1", source_refs: ref(0) },
      e2: { event_id: "e2", logic_unit_id: "lu_ok", step_id: "s2", source_refs: ref(1) },
      e3: { event_id: "e3", logic_unit_id: "lu_fiction", step_id: "s1", source_refs: ref(0) },
    },
    logic_units: {
      lu_ok: {
        logic_unit_id: "lu_ok",
        name: "Clean Process",
        state: "observed",
        trust_class: "derived",
        steps: [
          { step_id: "s1", text: "intake", evidence: [{ class: "de_facto", event_ids: ["e1"] }] },
          { step_id: "s2", text: "process", evidence: [{ class: "de_facto", event_ids: ["e2"] }] },
        ],
      },
      lu_fiction: {
        logic_unit_id: "lu_fiction",
        name: "Partly Fiction",
        state: "observed",
        trust_class: "derived",
        steps: [
          { step_id: "s1", text: "intake", evidence: [{ class: "de_facto", event_ids: ["e3"] }] },
          { step_id: "s2", text: "manager sign-off (SOP only)", evidence: [{ class: "de_jure", source_id: "s_sop" }] },
        ],
      },
    },
    version: { version_id: "v1", envelope: { source_hashes: { s_log: "sha256:log", s_sop: "sha256:sop" } }, operations: [] },
  } as unknown as PromoteOntology & Record<string, unknown>;
}

function writeAndValidate(ont: unknown): { ok: boolean; stderr: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-promote-"));
  const p = path.join(dir, "ontology.json");
  fs.writeFileSync(p, JSON.stringify(ont, null, 2));
  try {
    execFileSync(SVM, ["validate", p]);
    return { ok: true, stderr: "" };
  } catch (e) {
    return { ok: false, stderr: (e as { stderr?: Buffer }).stderr?.toString() ?? "" };
  }
}

vdescribe("Phase 9 — promotion + eligibility (G8)", () => {
  it("refuses a logic unit with a fiction-only step (G8)", () => {
    const elig = checkEligibility(validOntology(), "lu_fiction", 0.7);
    expect(elig.eligible).toBe(false);
    expect(elig.reasons.join(" ")).toMatch(/fiction-only/);
  });

  it("promotes a fully de-facto-attested logic unit to executable (L0) and it validates", () => {
    const ont = validOntology();
    expect(checkEligibility(ont, "lu_ok", 0.7).eligible).toBe(true);
    promote(ont, "lu_ok", "ready to automate");
    const lu = ont.logic_units!.lu_ok as { state: string; contract: { disposition: { effective: string } } };
    expect(lu.state).toBe("executable");
    expect(lu.contract.disposition.effective).toBe("L0");
    expect(writeAndValidate(ont).ok).toBe(true);
  });

  it("the standing G8 gate catches a forced promotion of a fiction unit", () => {
    const ont = validOntology();
    promote(ont, "lu_fiction"); // bypass the eligibility check
    const r = writeAndValidate(ont);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/eligibility|fiction/);
  });

  it("demote reverses a promotion (executable → observed, contract dropped)", () => {
    const ont = validOntology();
    promote(ont, "lu_ok");
    demote(ont, "lu_ok");
    const lu = ont.logic_units!.lu_ok as { state: string; contract?: unknown };
    expect(lu.state).toBe("observed");
    expect(lu.contract).toBeUndefined();
    expect(writeAndValidate(ont).ok).toBe(true);
  });
});

vdescribe("Phase 10 — autonomy floor (G9)", () => {
  it("derives the floor from reversibility × blast radius (spec 10 §5 table)", () => {
    expect(deriveFloor("reversible", 5, "derived", CFG)).toBe(3); // reversible + small
    expect(deriveFloor("reversible", 500, "derived", CFG)).toBe(2); // reversible + large
    expect(deriveFloor("irreversible", 5, "derived", CFG)).toBe(1); // irreversible + small
    expect(deriveFloor("irreversible", 500, "derived", CFG)).toBe(0); // irreversible + large
    expect(deriveFloor("unknown", 5, "derived", CFG)).toBe(1); // unknown treated as irreversible
    expect(deriveFloor("reversible", 5, "judged", CFG)).toBe(2); // judged: one-level penalty
  });

  it("an irreversible action cannot exceed L1 even when L3 is requested", () => {
    const ont = validOntology();
    promote(ont, "lu_ok", "go", { disposition: "L3", reversibility: "irreversible", blastEntities: 5, autonomy: CFG });
    const disp = (ont.logic_units!.lu_ok as { contract: { disposition: { requested: string; floor: string; effective: string } } }).contract.disposition;
    expect(disp.requested).toBe("L3");
    expect(disp.floor).toBe("L1");
    expect(disp.effective).toBe("L1"); // clamped to the floor; author only added... nothing
    expect(writeAndValidate(ont).ok).toBe(true); // within the floor → valid
  });

  it("a reversible small-blast action may reach L3 when requested", () => {
    const ont = validOntology();
    promote(ont, "lu_ok", "go", { disposition: "L3", reversibility: "reversible", blastEntities: 5, autonomy: CFG });
    const disp = (ont.logic_units!.lu_ok as { contract: { disposition: { effective: string } } }).contract.disposition;
    expect(disp.effective).toBe("L3");
    expect(writeAndValidate(ont).ok).toBe(true);
  });

  it("out-of-surface writes are refused fail-closed by the standing gate", () => {
    const ont = validOntology();
    // Declared surface writes only "Claim", but an output writes to "Foreign".
    promote(ont, "lu_ok", "go", { disposition: "L0", reversibility: "reversible", blastEntities: 5, writes: ["Claim"], outputs: [{ name: "leak", writes: "Foreign" }], autonomy: CFG });
    const r = writeAndValidate(ont);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/kinetic surface|autonomy/);
  });
});
