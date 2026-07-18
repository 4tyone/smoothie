// feedback loop closure (spec 08 §5-§6) — the producer reads pending consumer
// feedback from `.smoothie/feedback.jsonl` and runs it through the SAME gates as agent
// proposals. A consumer `add_link` enters at `fidelity: guessed, author: consumer` and
// is applied ONLY if it cites real evidence and its endpoints resolve (G1/G3);
// otherwise it is quarantined as a note, never masquerading as a grounded link.
// Every entry is marked (applied/quarantined/recorded) so a re-build never re-applies.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { OntologyDraft } from "./model.ts";
import type { BcFact } from "./describe.ts";

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
const sha12 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

interface FeedbackEntry {
  feedback_id?: string;
  kind: string;
  author?: string;
  targets: string[];
  link_type?: string;
  fact_ids?: string[];
  detail?: string | null;
  request_kind?: string;
  status?: string;
}

export interface FeedbackResult {
  notes: unknown[];
  appliedLinks: number;
  quarantined: number;
}

/** Apply pending consumer feedback to the draft (mutating it), returning notes to
 *  fold into the ontology and counts for telemetry. Rewrites the log with updated
 *  statuses. A no-op when no feedback file exists. */
export function applyFeedback(bcDir: string, draft: OntologyDraft, facts: BcFact[]): FeedbackResult {
  const fbPath = path.join(bcDir, "feedback.jsonl");
  if (!fs.existsSync(fbPath)) return { notes: [], appliedLinks: 0, quarantined: 0 };

  const entries: FeedbackEntry[] = fs
    .readFileSync(fbPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FeedbackEntry);

  const factSet = new Set(facts.map((f) => f.fact_id));
  const notes: unknown[] = [];
  const out: FeedbackEntry[] = [];
  let appliedLinks = 0;
  let quarantined = 0;

  for (const e of entries) {
    if (e.status && e.status !== "pending") {
      out.push(e);
      continue;
    }

    if (e.kind === "add_link") {
      const [from, to] = e.targets;
      const factIds = (e.fact_ids ?? []).filter((id) => factSet.has(id));
      const resolvable = Boolean(draft.entities[from] && draft.entities[to]);
      if (factIds.length && resolvable) {
        // Passes G1 (cited evidence) + G3 (endpoints resolve): enter as a guessed,
        // consumer-authored link.
        const ltId = "lt_" + slug(e.link_type ?? "related_to");
        const linkId = "l_fb_" + sha12(ltId + "|" + from + "|" + to);
        draft.links[linkId] = {
          link_id: linkId,
          link_type_id: ltId,
          from,
          to,
          properties: { author: "consumer", via: "feedback", ...(e.detail ? { why: e.detail } : {}) },
          provenance: { fact_ids: uniqSorted(factIds) },
          fidelity: "guessed",
        };
        if (!draft.link_types[ltId]) {
          draft.link_types[ltId] = {
            link_type_id: ltId,
            name: e.link_type ?? "related_to",
            from_type_id: "*",
            to_type_id: "*",
            cardinality: "many_to_many",
            directed: true,
            provenance: { fact_ids: uniqSorted(factIds) },
            status: "open",
          };
        }
        appliedLinks++;
        out.push({ ...e, status: "applied" });
      } else {
        const reason = !resolvable ? "endpoints do not resolve (G3)" : "no cited evidence (G1)";
        notes.push({ kind: "feedback_quarantine", feedback_id: e.feedback_id, text: `consumer add_link ${from} -> ${to} quarantined: ${reason}` });
        quarantined++;
        out.push({ ...e, status: "quarantined" });
      }
    } else {
      // note / request / link_research / propose_merge / dispute_merge: recorded as a
      // durable directive, never auto-applied (spec 08 §5).
      notes.push({ kind: `feedback_${e.kind}`, feedback_id: e.feedback_id, text: `consumer ${e.kind} ${JSON.stringify(e.targets)}${e.detail ? `: ${e.detail}` : ""}` });
      out.push({ ...e, status: "recorded" });
    }
  }

  fs.writeFileSync(fbPath, out.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { notes, appliedLinks, quarantined };
}
