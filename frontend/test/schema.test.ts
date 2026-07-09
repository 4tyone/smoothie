// Contract mirrors (spec 07 · schema single source). The valibot mirrors must be
// no looser than the JSON Schema, so a malformed processor envelope is rejected
// fail-closed at the producer, not later at `svm validate`.

import { describe as suite, it, expect } from "vitest";
import * as v from "valibot";
import { ExtractionEnvelope, DescribeResult } from "../src/bc/schemas.ts";

const base = {
  envelope: "smoothie.extraction.v1" as const,
  facts: [{ kind: "knowledge" as const, text: "x", confidence: 0.5, fidelity: "claimed" as const }],
};

suite("extraction.v1 valibot mirror", () => {
  it("accepts a valid companion kind", () => {
    const env = { ...base, companions: [{ kind: "frame", path: "frames/f1.png" }] };
    expect(() => v.parse(ExtractionEnvelope, env)).not.toThrow();
  });

  it("rejects an off-enum companion kind (matches the JSON Schema enum)", () => {
    const env = { ...base, companions: [{ kind: "hologram", path: "x" }] };
    expect(() => v.parse(ExtractionEnvelope, env)).toThrow();
  });

  it("rejects a fact confidence outside [0, 1] (processor envelope stays STRICT)", () => {
    const env = { ...base, facts: [{ kind: "knowledge" as const, text: "x", confidence: 5, fidelity: "claimed" as const }] };
    expect(() => v.parse(ExtractionEnvelope, env)).toThrow();
  });
});

suite("describe result is tolerant of the model's proposals (code normalizes)", () => {
  it("coerces an off-enum action verb to 'unknown' instead of rejecting", () => {
    // Regression: a real gpt-5.5 run emitted verb "visit" (a goto synonym), which
    // rejected the whole PDF extraction and fail-fast aborted an 82-source compile.
    const r = v.parse(DescribeResult, {
      facts: [{ kind: "action", text: "open the investor page", confidence: 0.8, fidelity: "claimed",
                action_draft: { verb: "visit", target: "investors.example.com" } }],
    });
    expect(r.facts[0].action_draft?.verb).toBe("unknown");
  });

  it("falls back on off-enum kind/fidelity and out-of-range confidence rather than rejecting", () => {
    const r = v.parse(DescribeResult, {
      facts: [{ kind: "observation", text: "x", confidence: 9, fidelity: "certain" }],
    });
    expect(r.facts[0].kind).toBe("knowledge");
    expect(r.facts[0].fidelity).toBe("claimed");
    expect(r.facts[0].confidence).toBe(0.5);
  });
});
