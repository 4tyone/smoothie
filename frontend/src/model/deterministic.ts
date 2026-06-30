// A deterministic, model-free gateway — strictly a CI/offline **determinism
// harness** (spec 07 · "a deterministic ... mode beside the real path"), NOT a
// substitute for the model. The real run uses `RealModelGateway` (the model on
// the user's ChatGPT subscription / API key) and is the default; this exists only
// so "same input → same BC" (spec 03) can be tested without a non-deterministic
// model in the loop. It produces a valid-but-mechanical graph; it is never a
// stand-in for real extraction.

import * as v from "valibot";
import type { ModelGateway, ExtractRequest } from "./gateway.ts";
import { DescribeResult, StructureResult, LinkResult, type Fact } from "../bc/schemas.ts";

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

/** Deterministic `describe` for ONE segment: a knowledge fact, plus an action
 *  fact when the text describes an interaction. Ids are assigned by the stage. */
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

/** Deterministic `structure` for ONE source → a local object (no outlines; those
 *  are reconciled at link). View is per-source so the linker has something to
 *  merge/connect across sources. Provenance is materialized by the stage. */
function detStructure(ctx: {
  profile: string;
  sourceId: string;
  urlPatterns: string[];
  facts: Array<{ fact_id: string; kind: string; text: string; action_draft?: { verb: string; target: string } }>;
}): v.InferOutput<typeof StructureResult> {
  const webApp = ctx.profile === "web-app";
  const viewId = `v-${ctx.sourceId}`;

  const nodes = ctx.facts.map((f) => {
    const id = `n-${f.fact_id}`;
    if (webApp && f.kind === "action" && f.action_draft) {
      const target = f.action_draft.target || f.text;
      return {
        id, title: target.slice(0, 60), summary: f.text, kind: "action" as const,
        view_id: viewId, fact_ids: [f.fact_id],
        action: f.action_draft.verb === "goto"
          ? { kind: "goto" as const, url: ctx.urlPatterns[0] ?? "/" }
          : { kind: "click" as const, locator: { description: target, primary: { by: "text" as const, value: target.slice(0, 40) }, fallbacks: [] } },
        checks: [{ kind: "url_matches" as const, expected: ctx.urlPatterns[0] ?? "/" }],
        fidelity: "claimed" as const,
      };
    }
    return {
      id, title: f.text.slice(0, 60), summary: f.text,
      kind: (webApp ? "feature" : "topic") as "feature" | "topic",
      view_id: webApp ? viewId : undefined, fact_ids: [f.fact_id],
      checks: [], fidelity: "claimed" as const,
    };
  });

  const edges = nodes.slice(1).map((n, i) => ({
    from: nodes[i].id, to: n.id, kind: "next" as const, fidelity: "claimed" as const,
  }));

  const views = webApp
    ? [{ view_id: viewId, title: ctx.sourceId, url_patterns: ctx.urlPatterns, node_ids: nodes.map((n) => n.id), fidelity: "claimed" as const }]
    : [];

  return { nodes, views, edges };
}

/** Deterministic `link`: induce cross-source connections so the graph is one
 *  connected whole. Connects each source's representative node to the next (cold),
 *  or the new source's first node to an existing node (incremental). */
function detLink(ctx: {
  existing_nodes: Array<{ id: string; view_id?: string }>;
  new_nodes: Array<{ id: string; view_id?: string }>;
}): v.InferOutput<typeof LinkResult> {
  const induced: Array<{ from: string; to: string; kind: "related_to" }> = [];
  if (ctx.existing_nodes.length && ctx.new_nodes.length) {
    induced.push({ from: ctx.new_nodes[0].id, to: ctx.existing_nodes[0].id, kind: "related_to" });
  } else {
    // Cold: one representative node per source (grouped by view_id), chained.
    const reps: string[] = [];
    const seen = new Set<string>();
    for (const n of ctx.new_nodes) {
      const v = n.view_id ?? "?";
      if (!seen.has(v)) { seen.add(v); reps.push(n.id); }
    }
    for (let i = 1; i < reps.length; i++) induced.push({ from: reps[i - 1], to: reps[i], kind: "related_to" });
  }
  return { view_merges: [], induced_edges: induced, orphans: [] };
}

export class DeterministicModelGateway implements ModelGateway {
  readonly kind = "stub" as const;

  async extract<S extends v.GenericSchema>(req: ExtractRequest<S>): Promise<v.InferOutput<S>> {
    if (req.label.startsWith("describe")) {
      return v.parse(req.schema, fakeDescribe(req.content));
    }
    if (req.label.startsWith("structure")) {
      const ctx = JSON.parse(req.content) as Parameters<typeof detStructure>[0];
      return v.parse(req.schema, detStructure(ctx));
    }
    if (req.label.startsWith("link")) {
      const ctx = JSON.parse(req.content) as Parameters<typeof detLink>[0];
      return v.parse(req.schema, detLink(ctx));
    }
    throw new Error(`DeterministicModelGateway: no responder for label '${req.label}'`);
  }
}
