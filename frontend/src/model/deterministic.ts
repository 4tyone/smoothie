// A deterministic, model-free gateway — strictly a CI/offline **determinism
// harness** (spec 07 · "a deterministic ... mode beside the real path"), NOT a
// substitute for the model. The real run uses `RealModelGateway` (the model on the
// user's ChatGPT subscription / API key) and is the default; this exists only so
// "same input → same ontology" (spec 05) can be tested without a non-deterministic
// model in the loop. It produces a valid-but-mechanical ontology; it is never a
// stand-in for real extraction.

import * as v from "valibot";
import type { ModelGateway, ExtractRequest } from "./gateway.ts";
import { DescribeResult, type Fact } from "../bc/schemas.ts";
import { ModelResult } from "../ontology/schemas.ts";
import { similarity } from "../stages/resolve-sim.ts";

const ACTION_VERBS: Array<[RegExp, "goto" | "click" | "fill" | "select"]> = [
  [/\bgo to\b|\bnavigate\b|\bopen the\b|\bvisit\b/i, "goto"],
  [/\bclick\b|\bpress the\b|\btap\b|\bselect the .*button\b/i, "click"],
  [/\benter\b|\btype\b|\bfill\b/i, "fill"],
  [/\bchoose\b|\bselect\b/i, "select"],
];

function firstSentence(text: string): string {
  const cleaned = text.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
  const m = /^(.{1,200}?[.!?])(\s|$)/.exec(cleaned);
  return (m ? m[1] : cleaned.slice(0, 200)).trim();
}

/** Deterministic `describe` for ONE segment: a knowledge fact, plus an action fact
 *  when the text describes an interaction. Ids are assigned by the stage. */
function fakeDescribe(content: string): v.InferOutput<typeof DescribeResult> {
  const summary = firstSentence(content);
  const facts: Fact[] = [
    { fact_id: "k", kind: "knowledge", text: summary, confidence: 0.7, fidelity: "claimed" },
  ];
  for (const [re, verb] of ACTION_VERBS) {
    if (re.test(content)) {
      facts.push({
        fact_id: "a",
        kind: "action",
        text: summary,
        confidence: 0.6,
        fidelity: "claimed",
        action_draft: { verb, target: summary.slice(0, 60), expected_effect: "advances the flow" },
      });
      break;
    }
  }
  return { facts };
}

/** Deterministic ontology `model` (spec 09 §4 · the model-free gateway): one
 *  candidate entity per fact, typed mechanically. A fact whose text contains a
 *  glossary surface form with a seed `type` is typed to it (the segment rename
 *  becomes a `Segment`); otherwise it is a `Topic`. Entity resolution by natural key
 *  + glossary equivalence happens deterministically in the `model` stage; this
 *  gateway only proposes. Purely reproducible; the real gateway uses the model. */
function detModel(ctx: {
  facts: Array<{ fact_id: string; text: string; source_id: string }>;
  glossary?: Array<{ term: string; aliases?: string[]; type?: string }>;
}): v.InferOutput<typeof ModelResult> {
  const groups = (ctx.glossary ?? []).filter((g) => g.type);
  const typeFor = (text: string): string => {
    const lc = text.toLowerCase();
    for (const g of groups) {
      const forms = [g.term, ...(g.aliases ?? [])];
      if (forms.some((f) => lc.includes(f.toLowerCase()))) return g.type as string;
    }
    return "Topic";
  };
  const entities = ctx.facts.map((f) => {
    const label = firstSentence(f.text);
    return { type: typeFor(f.text), label, aliases: [label], fact_ids: [f.fact_id] };
  });
  return { entities, links: [] };
}

export class DeterministicModelGateway implements ModelGateway {
  readonly kind = "stub" as const;

  async extract<S extends v.GenericSchema>(req: ExtractRequest<S>): Promise<v.InferOutput<S>> {
    if (req.label.startsWith("describe")) {
      return v.parse(req.schema, fakeDescribe(req.content));
    }
    if (req.label.startsWith("model")) {
      const ctx = JSON.parse(req.content) as Parameters<typeof detModel>[0];
      return v.parse(req.schema, detModel(ctx));
    }
    if (req.label.startsWith("resolve-verify")) {
      // The independent verifier: a STRICTER same/different bar (spec 04 §2.3).
      const { a, b } = JSON.parse(req.content) as { a: { surfaces: string[] }; b: { surfaces: string[] } };
      return v.parse(req.schema, { yes: similarity(a.surfaces, b.surfaces) >= 0.9 });
    }
    if (req.label.startsWith("resolve")) {
      // The proposing judge: does the model think these might be the same entity?
      const { a, b } = JSON.parse(req.content) as { a: { surfaces: string[] }; b: { surfaces: string[] } };
      return v.parse(req.schema, { yes: similarity(a.surfaces, b.surfaces) >= 0.5 });
    }
    throw new Error(`DeterministicModelGateway: no responder for label '${req.label}'`);
  }
}
