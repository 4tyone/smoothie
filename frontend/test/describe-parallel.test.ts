// Parallel describe (bounded pool) must be deterministic: the assembled facts are
// ordered by SOURCE, never by which source's agent finished first. The fan-out is a
// wall-clock win only — same input → same output — so non-determinism stays confined
// inside each source's extraction (spec 03 · determinism).

import { describe as suite, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe } from "../src/stages/describe.ts";
import type { ModelGateway } from "../src/model/gateway.ts";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smoothie-par-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.SMOOTHIE_DESCRIBE_CONCURRENCY; });

/** Five sources, ingest-sorted by id. */
function makeSources() {
  const corpus = path.join(tmp, "corpus");
  fs.mkdirSync(corpus, { recursive: true });
  const names = ["a", "b", "c", "d", "e"];
  return names.map((n) => {
    const rel = `${n}.md`;
    fs.writeFileSync(path.join(corpus, rel), `# ${n}\nbody ${n}`);
    return { source_id: `src-${n}-md`, kind: "markdown", path: path.join(corpus, rel), relPath: rel, hash: `h-${n}` };
  });
}

/** A fake agent gateway that finishes each source after a delay chosen so LATER
 *  sources complete FIRST — proving output order can't be completion order. Each
 *  source yields one fact naming itself. */
function jitterGateway(): ModelGateway {
  const order = ["a", "b", "c", "d", "e"];
  return {
    kind: "real",
    async extract() { throw new Error("unused"); },
    async extractWithTools(req) {
      const base = req.user.match(/"([^"]+\.md)"/)?.[1] ?? "";
      const letter = base.replace(".md", "");
      const idx = order.indexOf(letter);
      // reverse-index delay: 'e' (idx 4) waits ~1ms, 'a' (idx 0) waits ~25ms.
      await new Promise((r) => setTimeout(r, (order.length - idx) * 5));
      return { facts: [{ kind: "knowledge", text: `from ${letter}`, confidence: 0.9, fidelity: "claimed", locator: "l" }] } as never;
    },
  };
}

suite("parallel describe", () => {
  it("assembles facts in source order regardless of completion order", async () => {
    process.env.SMOOTHIE_DESCRIBE_CONCURRENCY = "5"; // all at once
    const corpus = path.join(tmp, "corpus");
    const bundle = await describe(makeSources(), jitterGateway(), path.join(corpus, ".smoothie"), "b1", {}, { folder: corpus, modalities: {} });
    // Despite 'e' finishing first and 'a' last, facts are in source (a→e) order.
    expect(bundle.facts.map((f) => f.fact_id)).toEqual([
      "src-a-md-f0", "src-b-md-f0", "src-c-md-f0", "src-d-md-f0", "src-e-md-f0",
    ]);
    expect(bundle.facts.map((f) => f.text)).toEqual(["from a", "from b", "from c", "from d", "from e"]);
  });

  it("isolates a single source's failure — skips it, keeps the rest", async () => {
    // One bad source must NOT abort the whole run (the cat_case_study lesson: a
    // 63/82 compile died over one source). The failing source is skipped + reported.
    const corpus = path.join(tmp, "corpus");
    fs.mkdirSync(corpus, { recursive: true });
    const srcs = ["a", "b", "c"].map((n) => {
      fs.writeFileSync(path.join(corpus, `${n}.md`), `# ${n}`);
      return { source_id: `src-${n}-md`, kind: "markdown", path: path.join(corpus, `${n}.md`), relPath: `${n}.md`, hash: `h-${n}` };
    });
    const gateway: ModelGateway = {
      kind: "real",
      async extract() { throw new Error("unused"); },
      async extractWithTools(req) {
        if (req.user.includes('"b.md"')) throw new Error("model went sideways on b");
        const letter = req.user.match(/"([a-z])\.md"/)?.[1];
        return { facts: [{ kind: "knowledge", text: `from ${letter}`, confidence: 0.9, fidelity: "claimed", locator: "l" }] } as never;
      },
    };
    const b = await describe(srcs, gateway, path.join(corpus, ".smoothie"), "b1", {}, { folder: corpus, modalities: {} });
    // a and c succeeded; b was skipped, not fatal.
    expect(b.facts.map((f) => f.text).sort()).toEqual(["from a", "from c"]);
    expect(b.skipped.map((s) => s.source_id)).toEqual(["src-b-md"]);
    expect(b.skipped[0].error).toContain("sideways");
  });

  it("produces identical output at concurrency 1 and 5", async () => {
    const run = async (limit: string) => {
      process.env.SMOOTHIE_DESCRIBE_CONCURRENCY = limit;
      const corpus = path.join(tmp, `c${limit}`);
      fs.mkdirSync(corpus, { recursive: true });
      const srcs = ["a", "b", "c", "d", "e"].map((n) => {
        fs.writeFileSync(path.join(corpus, `${n}.md`), `# ${n}\nbody ${n}`);
        return { source_id: `src-${n}-md`, kind: "markdown", path: path.join(corpus, `${n}.md`), relPath: `${n}.md`, hash: `h-${n}` };
      });
      const b = await describe(srcs, jitterGateway(), path.join(corpus, ".smoothie"), "b1", {}, { folder: corpus, modalities: {} });
      return JSON.stringify(b.facts);
    };
    expect(await run("1")).toEqual(await run("5"));
  });
});
