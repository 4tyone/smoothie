// Phase 3 gate (IMPLEMENTATION.md · Phase 3; spec 09 §6.2): entity resolution as a
// gated, verified, reversible stage (spec 04). Asserts precision/recall on a labeled
// candidate set, that the independent verifier is consulted (and can veto) in the
// mid-confidence band, and that `resolve` then `unresolve` restores the prior state.
// Uses the deterministic gateway (surface-form similarity) so it is reproducible.

import { describe as vdescribe, it, expect } from "vitest";
import { DeterministicModelGateway } from "../src/model/deterministic.ts";
import { decidePair, resolveEntities, unresolve, type ResolveConfig } from "../src/stages/resolve-entities.ts";
import type { ModelGateway } from "../src/model/gateway.ts";
import type { EntityOut } from "../src/stages/model.ts";

const CONFIG: ResolveConfig = { merge_confidence: 0.8, verify_below: 0.9, block_by: ["type", "identity", "alias"] };

const ent = (id: string, label: string, type = "et_company"): EntityOut => ({
  entity_id: id,
  type_id: type,
  label,
  aliases: [],
  properties: { name: [{ value: label, fact_ids: [`${id}-f`], fidelity: "claimed" }] },
  provenance: { fact_ids: [`${id}-f`], source_ids: ["s"] },
  status: "active",
});

/** A gateway that records which judge labels were called, wrapping the deterministic one. */
function spyGateway(): { gw: ModelGateway; calls: string[] } {
  const calls: string[] = [];
  const inner = new DeterministicModelGateway();
  const gw = {
    kind: "stub",
    async extract(req: { label: string }) {
      calls.push(req.label);
      return inner.extract(req as never);
    },
  } as unknown as ModelGateway;
  return { gw, calls };
}

vdescribe("Phase 3 — entity resolution (resolve stage)", () => {
  it("meets precision/recall targets on a labeled candidate set", async () => {
    const gw = new DeterministicModelGateway();
    // [a, b, gold-same?]
    const pairs: Array<[EntityOut, EntityOut, boolean]> = [
      [ent("a1", "Caterpillar Inc."), ent("a2", "Caterpillar"), true],
      [ent("b1", "Power & Energy"), ent("b2", "Power and Energy"), true],
      [ent("c1", "Financial Products"), ent("c2", "Financial Products Inc"), true],
      [ent("d1", "Construction Industries"), ent("d2", "Resource Industries"), false],
      [ent("e1", "Caterpillar"), ent("e2", "Cat Financial"), false],
      // Mid-band (confidence 0.8): the verifier vetoes it → a false negative.
      [ent("f1", "North American Construction Industries Group"), ent("f2", "American Construction Industries Group Holdings"), true],
    ];

    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const [a, b, gold] of pairs) {
      const { accept } = await decidePair(a, b, gw, CONFIG);
      if (accept && gold) tp++;
      else if (accept && !gold) fp++;
      else if (!accept && gold) fn++;
      else tn++;
    }
    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);

    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.7);
    // Exact shape: no false merges, the mid-band same-pair is the only miss.
    expect({ tp, fp, fn, tn }).toEqual({ tp: 3, fp: 0, fn: 1, tn: 2 });
  });

  it("consults the independent verifier only in the mid-confidence band", async () => {
    const mid = spyGateway();
    await decidePair(
      ent("f1", "North American Construction Industries Group"),
      ent("f2", "American Construction Industries Group Holdings"),
      mid.gw,
      CONFIG,
    );
    expect(mid.calls).toContain("resolve-verify"); // confidence 0.8 < verify_below

    const high = spyGateway();
    await decidePair(ent("a1", "Caterpillar Inc."), ent("a2", "Caterpillar"), high.gw, CONFIG);
    expect(high.calls).not.toContain("resolve-verify"); // confidence 0.9 ≥ verify_below
  });

  it("blocks by type — same label, different type never merges", async () => {
    const gw = new DeterministicModelGateway();
    const { accept } = await decidePair(ent("x", "Caterpillar", "et_company"), ent("y", "Caterpillar", "et_topic"), gw, CONFIG);
    expect(accept).toBe(false);
  });

  it("materializes a reversible resolution, and unresolve restores the prior state", async () => {
    const gw = new DeterministicModelGateway();
    const entities: Record<string, EntityOut> = {
      a1: ent("a1", "Caterpillar Inc."),
      a2: ent("a2", "Caterpillar"),
      z: ent("z", "Weather Report"),
    };
    const before = JSON.stringify(entities);

    const out = await resolveEntities({ entities, entity_types: {} }, gw, CONFIG);
    expect(Object.keys(out.resolutions).length).toBe(1);

    const rid = Object.keys(out.resolutions)[0];
    const res = out.resolutions[rid];
    // G5 invariants on the produced resolution (spec 01 §7).
    expect(res.reversible).toBe(true);
    expect(res.evidence.fact_ids.length).toBeGreaterThan(0);
    expect(out.entities[res.canonical].resolved_from).toEqual(expect.arrayContaining(res.members));
    for (const m of res.members) expect(out.entities[m].merged_into).toBe(res.canonical);
    // The unrelated entity is untouched (no false merge).
    expect(out.entities.z.merged_into).toBeUndefined();

    // Reverse: unresolve restores the pre-merge state exactly.
    const rev = unresolve(out.entities, out.resolutions, [rid]);
    expect(Object.keys(rev.resolutions).length).toBe(0);
    expect(JSON.stringify(rev.entities)).toBe(before);
  });
});
