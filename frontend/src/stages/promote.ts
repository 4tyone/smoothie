// promote / demote (spec 10 §3-§4) — the load-bearing operation of the verb layer:
// transition a logic unit `observed → executable` and bind its executable contract,
// or reverse it. Gated by G8 eligibility (spec 10 §2): every step must be attested by
// de facto evidence (never fiction-only) and conflict-free, and the de-facto support
// must clear the configured threshold. Author is always human; this phase pins the
// disposition to L0 (propose-only) — the derived autonomy floor is Phase 10 (G9).

interface Evidence {
  class: string;
  contradicts?: boolean;
}
interface Step {
  step_id: string;
  evidence?: Evidence[];
}
interface LogicUnit {
  logic_unit_id: string;
  state: string;
  trust_class?: string;
  steps?: Step[];
  contract?: unknown;
}

const LEVELS = ["L0", "L1", "L2", "L3"];
const levelNum = (s: string): number => (LEVELS.indexOf(s) >= 0 ? LEVELS.indexOf(s) : 0);
const levelStr = (n: number): string => LEVELS[Math.max(0, Math.min(3, n))];

export interface AutonomyConfig {
  blastSmallMax: number;
  judgedPenalty: number;
}

/** The derived autonomy floor (spec 10 §5): the MAX autonomy an action may reach,
 *  from reversibility × blast radius, minus a one-level penalty for judged units.
 *  reversible+small=L3, reversible+large=L2, irreversible/unknown+small=L1,
 *  irreversible/unknown+large=L0. Returns a level number 0-3. */
export function deriveFloor(reversibility: string, blastEntities: number, trustClass: string, cfg: AutonomyConfig): number {
  const reversible = reversibility === "reversible";
  const blastLarge = blastEntities > cfg.blastSmallMax;
  const base = reversible ? (blastLarge ? 2 : 3) : blastLarge ? 0 : 1;
  const penalty = trustClass === "judged" ? cfg.judgedPenalty : 0;
  return Math.max(0, base - penalty);
}

export interface PromoteOpts {
  /** Requested autonomy L0-L3 (default L0). Effective = min(requested, floor). */
  disposition?: string;
  /** `reversible` | `irreversible` | `unknown` (default unknown → irreversible). */
  reversibility?: string;
  blastEntities?: number;
  reads?: string[];
  writes?: string[];
  forbid?: string[];
  outputs?: Array<{ name: string; writes?: string }>;
  autonomy?: AutonomyConfig;
}
export interface PromoteOntology {
  logic_units?: Record<string, LogicUnit>;
  events?: Record<string, { logic_unit_id: string; step_id?: string }>;
  version: { operations?: unknown[] };
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  deFactoRatio: number;
}

/** G8 (spec 10 §2): is a logic unit eligible for promotion? Every step must be
 *  de-facto-attested (via an event or de_facto evidence) and conflict-free, and the
 *  de-facto support must reach `minDeFacto`. Returns the reasons a refusal is a
 *  refusal — the "fiction-only step" is named. */
export function checkEligibility(ont: PromoteOntology, luId: string, minDeFacto: number): Eligibility {
  const lu = ont.logic_units?.[luId];
  if (!lu) return { eligible: false, reasons: [`logic unit ${luId} not found`], deFactoRatio: 0 };
  if (lu.state === "executable") return { eligible: false, reasons: [`${luId} is already executable`], deFactoRatio: 1 };

  const reasons: string[] = [];
  const steps = lu.steps ?? [];
  let deFacto = 0;
  for (const step of steps) {
    const ev = step.evidence ?? [];
    const hasDeFacto =
      ev.some((e) => e.class === "de_facto") ||
      Object.values(ont.events ?? {}).some((e) => e.logic_unit_id === luId && e.step_id === step.step_id);
    const conflict = ev.some((e) => e.contradicts === true);
    if (conflict) reasons.push(`step ${step.step_id} has an unresolved conflict`);
    if (hasDeFacto) deFacto++;
    else reasons.push(`step ${step.step_id} is fiction-only (no de facto attestation)`);
  }
  const deFactoRatio = steps.length ? deFacto / steps.length : 0;
  if (deFactoRatio < minDeFacto) reasons.push(`de-facto support ${deFactoRatio.toFixed(2)} < required ${minDeFacto}`);

  return { eligible: reasons.length === 0, reasons, deFactoRatio };
}

/** Promote a logic unit to executable, binding its contract with the DERIVED autonomy
 *  floor (spec 10 §5): the author may request an autonomy level, but the effective
 *  disposition is the more-supervised of the request and the floor. Records the
 *  human-authored `promote` Operation. Caller must have checked G8. */
export function promote(ont: PromoteOntology, luId: string, why?: string, opts: PromoteOpts = {}): void {
  const lu = ont.logic_units![luId];
  const trustClass = lu.trust_class ?? "derived";
  const reversibility = opts.reversibility ?? "unknown";
  const blastEntities = opts.blastEntities ?? 0;
  const cfg = opts.autonomy ?? { blastSmallMax: 50, judgedPenalty: 1 };

  const floorNum = deriveFloor(reversibility, blastEntities, trustClass, cfg);
  const requestedNum = levelNum(opts.disposition ?? "L0");
  const effectiveNum = Math.min(requestedNum, floorNum); // author may only add oversight

  // Freeze the de-facto-attested steps as the baseline the conformance loop measures
  // drift against (spec 10 §6).
  const baselineSteps = (lu.steps ?? [])
    .filter((step) => {
      const ev = step.evidence ?? [];
      return ev.some((e) => e.class === "de_facto") || Object.values(ont.events ?? {}).some((e) => e.logic_unit_id === luId && e.step_id === step.step_id);
    })
    .map((s) => s.step_id);

  lu.state = "executable";
  lu.contract = {
    inputs: [],
    outputs: opts.outputs ?? [],
    restrictions: { reads: opts.reads ?? [], writes: opts.writes ?? [], forbid: opts.forbid ?? [] },
    reversibility,
    blast_radius: { entities: blastEntities },
    baseline_steps: baselineSteps,
    logging: { events: ["invoked", "produced", "committed"], snapshot: ["inputs_ref", "output"] },
    disposition: { requested: opts.disposition ?? "L0", floor: levelStr(floorNum), effective: levelStr(effectiveNum) },
  };
  ont.version.operations = [
    ...(ont.version.operations ?? []),
    { op: "promote", logic_unit_id: luId, author: "human", disposition: levelStr(effectiveNum), ...(why ? { why } : {}) },
  ];
}

/** Reverse a promotion (spec 10 §3): executable → observed, drop the contract, record
 *  the `demote` Operation. Author is `human` for a manual demote, `system` for a
 *  drift-triggered one (spec 10 §6). Never a history rewrite. */
export function demote(ont: PromoteOntology, luId: string, why?: string, author: string = "human"): void {
  const lu = ont.logic_units![luId];
  lu.state = "observed";
  delete lu.contract;
  ont.version.operations = [
    ...(ont.version.operations ?? []),
    { op: "demote", logic_unit_id: luId, author, ...(why ? { why } : {}) },
  ];
}
