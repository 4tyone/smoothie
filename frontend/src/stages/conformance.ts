// conformance loop (spec 10 §6) — continuously check each executable logic unit's
// frozen baseline against the live event stream. Drift is the Jaccard distance
// between the steps attested at promotion and the steps attested now. Below
// `drift_alert` nothing happens; at or above it an alert is recorded; at or above
// `drift_max` the flow is AUTO-DEMOTED to observed (author: system), failing safe
// rather than executing on stale assumptions. This is what earns trust on a
// discovered (rather than hand-authored) ontology.

import { demote, type PromoteOntology } from "./promote.ts";

export interface DriftConfig {
  driftAlert: number;
  driftMax: number;
}

export interface DriftItem {
  luId: string;
  drift: number;
  action: "none" | "alert" | "demote";
}

interface ConformanceLU {
  state: string;
  contract?: { baseline_steps?: string[] };
}
interface ConformanceOntology extends PromoteOntology {
  logic_units?: Record<string, ConformanceLU & { logic_unit_id: string; state: string }>;
  events?: Record<string, { logic_unit_id: string; step_id?: string }>;
  notes?: unknown[];
}

/** Jaccard distance between two step-id sets (0 = identical, 1 = disjoint). */
function jaccardDistance(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : 1 - inter / union;
}

/** Measure drift per executable logic unit and classify the action. Read-only. */
export function checkDrift(ont: ConformanceOntology, cfg: DriftConfig): DriftItem[] {
  const out: DriftItem[] = [];
  for (const [luId, lu] of Object.entries(ont.logic_units ?? {})) {
    if (lu.state !== "executable") continue;
    const baseline = lu.contract?.baseline_steps ?? [];
    const current = [
      ...new Set(
        Object.values(ont.events ?? {})
          .filter((e) => e.logic_unit_id === luId)
          .map((e) => e.step_id)
          .filter((s): s is string => Boolean(s)),
      ),
    ];
    const drift = jaccardDistance(baseline, current);
    const action = drift >= cfg.driftMax ? "demote" : drift >= cfg.driftAlert ? "alert" : "none";
    out.push({ luId, drift, action });
  }
  return out;
}

export interface ConformanceResult {
  demoted: string[];
  alerts: string[];
  notes: unknown[];
}

/** Run the conformance loop, mutating the ontology: auto-demote drifted flows to
 *  observed (author: system) and record alerts/demotes as notes. */
export function runConformance(ont: ConformanceOntology, cfg: DriftConfig): ConformanceResult {
  const demoted: string[] = [];
  const alerts: string[] = [];
  const notes: unknown[] = [];
  for (const it of checkDrift(ont, cfg)) {
    const d = it.drift.toFixed(2);
    if (it.action === "demote") {
      demote(ont, it.luId, `drift ${d} ≥ drift_max ${cfg.driftMax} — failing safe to observed`, "system");
      demoted.push(it.luId);
      notes.push({ kind: "conformance_demote", logic_unit_id: it.luId, drift: it.drift, text: `auto-demoted ${it.luId} to observed (drift ${d})` });
    } else if (it.action === "alert") {
      alerts.push(it.luId);
      notes.push({ kind: "conformance_alert", logic_unit_id: it.luId, drift: it.drift, text: `drift alert on ${it.luId} (drift ${d})` });
    }
  }
  return { demoted, alerts, notes };
}
