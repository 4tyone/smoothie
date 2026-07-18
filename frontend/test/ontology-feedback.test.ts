// Phase 7 gate, part 2 (IMPLEMENTATION.md · Phase 7; spec 09 §6.6): consumer feedback
// passes the SAME gates as agent proposals (spec 08 §6). A consumer `add-link` with
// cited evidence and resolvable endpoints enters as a guessed, consumer-authored link
// and the ontology still validates (G1-G7); one without evidence is quarantined as a
// note, never a link.

import { describe as vdescribe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runOntologyCompile } from "../src/pipeline-ontology.ts";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MULTI = path.join(HERE, "fixtures/ontology-multi");
const SVM = (() => {
  for (const p of ["release", "debug"]) {
    const c = path.join(HERE, "..", "..", "target", p, "svm");
    if (fs.existsSync(c)) return c;
  }
  throw new Error("svm binary not built — run `cargo build` first");
})();

function corpus(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-fb-"));
  for (const f of fs.readdirSync(MULTI)) fs.copyFileSync(path.join(MULTI, f), path.join(dir, f));
  return dir;
}
const compileOf = (dir: string) => runOntologyCompile(dir, { gateway: new DeterministicModelGateway(), svmBin: SVM, git: false });
const readOnt = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, ".smoothie/ontology.json"), "utf8"));
const fbLinks = (o: { links: Record<string, { link_id: string }> }) =>
  Object.values(o.links).filter((l) => l.link_id.startsWith("l_fb_"));

vdescribe("Phase 7 — consumer feedback is gated like agent proposals", () => {
  it("a grounded add-link enters as a guessed, consumer-authored link and validates", async () => {
    const dir = corpus();
    await compileOf(dir);
    const ont = readOnt(dir);
    const [from, to] = Object.keys(ont.entities);
    const factId = Object.keys(ont.facts)[0];

    // The reader records the proposal with cited evidence (a real fact).
    execFileSync(SVM, ["feedback", "add-link", from, to, "--type", "relates_to", "--why", "cross-division link", "--fact", factId], { cwd: dir });

    // The producer's next build applies it through the gates.
    const run = await compileOf(dir);
    expect(run.validated).toBe(true);

    const links = fbLinks(readOnt(dir));
    expect(links.length).toBe(1);
    expect(links[0]).toMatchObject({ fidelity: "guessed", from, to, properties: { author: "consumer", via: "feedback" } });
  });

  it("an ungrounded add-link is quarantined as a note, never a link", async () => {
    const dir = corpus();
    await compileOf(dir);
    const ont = readOnt(dir);
    const [from, to] = Object.keys(ont.entities);

    // No --fact: the proposal cites no evidence.
    execFileSync(SVM, ["feedback", "add-link", from, to, "--type", "relates_to", "--why", "hunch"], { cwd: dir });

    const run = await compileOf(dir);
    expect(run.validated).toBe(true); // the ontology stays valid — nothing forged
    const after = readOnt(dir);
    expect(fbLinks(after).length).toBe(0); // no link created
    expect(JSON.stringify(after.notes)).toMatch(/quarantined/); // recorded as a gap, not applied
  });
});
