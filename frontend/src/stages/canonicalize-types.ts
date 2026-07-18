// canonicalize (spec 03 · vocabulary consolidation) — the model coins a fine-grained
// type and relation vocabulary (one bespoke type/predicate per sentence), which
// sprawls the schema: many singleton types like `Observation`/`Measurement`/`Metric`
// and predicates like `affects`/`affected_by`/`affects_reported_sales`. This stage
// consolidates BOTH vocabularies onto a smaller canonical set — WITHOUT any
// domain-specific rules.
//
// Two layers, mirroring the rest of the compiler:
//   1. a deterministic signature pre-fold (normalize.ts) collapses pure inflection /
//      word-order / stopword variants — free, byte-stable, no model.
//   2. the MODEL proposes the remaining SEMANTIC merges (synonyms, a hypernym that
//      subsumes near-duplicates) over the corpus's OWN names; CODE DISPOSES: the gate
//      keeps only mappings whose target is an observed name (fail closed to identity),
//      so the model can never invent a type. The mapping is cached by content hash for
//      deterministic replay (spec 05 §2), exactly like the model batch cache.
//
// The deterministic gateway skips the model entirely and returns the signature fold,
// so "same input → same ontology" holds offline.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { CanonicalizeResult } from "../ontology/schemas.ts";
import { canonicalizeNames } from "./normalize.ts";
import type { ModelGateway } from "../model/gateway.ts";
import type { StageSettings } from "../config.ts";

export interface TypeMaps {
  /** observed entity-type name → canonical entity-type name */
  entityTypes: Map<string, string>;
  /** observed link-type name → canonical link-type name */
  linkTypes: Map<string, string>;
}

const SYSTEM =
  "You are the CANONICALIZE stage of an ontology compiler. You are given the OBSERVED " +
  "vocabulary of a knowledge graph: entity-type names and relation (link-type) names, " +
  "each with the count of how many entities/links use it. Consolidate each vocabulary " +
  "onto a SMALLER canonical set. Merge names that denote the SAME KIND of thing: exact " +
  "synonyms, and a more general name that clearly subsumes near-duplicates in THIS " +
  "corpus (e.g. a specific measurement kind folded into the general metric kind). Keep " +
  "genuinely distinct kinds separate — do not over-merge. Rules: the canonical `to` " +
  "MUST be one of the observed names (never invent a name); prefer the most frequent, " +
  "most general observed name as canonical; a name that is already canonical maps to " +
  "itself (you may omit it). Judge by MEANING, not shared characters. Return JSON: " +
  '{ "entity_types": [ { "from": string, "to": string } ], "link_types": [ { "from": ' +
  'string, "to": string } ] }.';

/** Cache key: same observed vocabulary + model ⇒ same canonical mapping (deterministic
 *  replay). Counts are included so a shift in the corpus re-derives the mapping. */
function cacheKey(entity: Map<string, number>, link: Map<string, number>, stage: StageSettings): string {
  const canonical = JSON.stringify({
    entity: [...entity.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    link: [...link.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    model: stage.model ?? "",
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Compose the deterministic signature fold with the model's semantic mapping, keeping
 *  only targets that are real observed names (fail closed). Both maps are total over
 *  the observed names. */
function composeGated(
  observed: Map<string, number>,
  signatureFold: Map<string, string>,
  modelMap: Array<{ from: string; to: string }>,
): Map<string, string> {
  const names = new Set(observed.keys());
  // Start from the deterministic fold (already total, targets are observed names).
  const out = new Map<string, string>();
  for (const n of names) out.set(n, signatureFold.get(n) ?? n);

  // Layer the model's semantic merges on top, gated: target must be observed, and must
  // not point back through a chain to itself. We resolve one hop then flatten.
  const semantic = new Map<string, string>();
  for (const { from, to } of modelMap) {
    if (!names.has(from) || !names.has(to) || from === to) continue; // gate: real names only
    semantic.set(from, to);
  }
  // Flatten chains (a→b→c ⇒ a→c), bounded, so the final target is stable.
  const resolve = (n: string): string => {
    let cur = n;
    const seen = new Set<string>();
    while (semantic.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = semantic.get(cur)!;
    }
    return cur;
  };
  for (const n of names) {
    // Apply the signature fold first (n → foldTarget), then the semantic map on the
    // fold target, so both layers compose.
    const folded = out.get(n)!;
    out.set(n, resolve(folded));
  }
  return out;
}

/** Consolidate the observed type/relation vocabularies. `observedEntityTypes` and
 *  `observedLinkTypes` are name→count. Returns total maps (every observed name → its
 *  canonical name). The deterministic gateway returns the signature fold only. */
export async function canonicalizeTypes(
  observedEntityTypes: Map<string, number>,
  observedLinkTypes: Map<string, number>,
  gateway: ModelGateway,
  stage: StageSettings = {},
  cacheDir?: string,
): Promise<TypeMaps> {
  const entityFold = canonicalizeNames(expand(observedEntityTypes));
  const linkFold = canonicalizeNames(expand(observedLinkTypes));

  // Deterministic path: signature fold only, no model (byte-stable offline).
  if (gateway.kind === "stub") {
    return {
      entityTypes: total(observedEntityTypes, entityFold),
      linkTypes: total(observedLinkTypes, linkFold),
    };
  }

  // Real path: model proposes semantic merges over the fold, cached by content hash.
  const key = cacheKey(observedEntityTypes, observedLinkTypes, stage);
  const cacheFile = cacheDir ? path.join(cacheDir, `canon-${key}.json`) : undefined;

  let result: import("valibot").InferOutput<typeof CanonicalizeResult> | undefined;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      result = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      process.stderr.write("canonicalize: cache hit\n");
    } catch {
      result = undefined;
    }
  }
  if (!result) {
    process.stderr.write(`canonicalize: ${observedEntityTypes.size} entity types, ${observedLinkTypes.size} link types — calling model\n`);
    const entityLines = [...observedEntityTypes.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `- ${n} (${c})`).join("\n");
    const linkLines = [...observedLinkTypes.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `- ${n} (${c})`).join("\n");
    result = await gateway.extract({
      label: "canonicalize",
      instruction: SYSTEM,
      content: `ENTITY TYPES (name (count)):\n${entityLines}\n\nRELATION / LINK TYPES (name (count)):\n${linkLines}\n\nConsolidate each vocabulary.`,
      schema: CanonicalizeResult,
      ...(stage.model ? { model: stage.model } : {}),
      ...(stage.thinking ? { reasoning: stage.thinking } : {}),
    });
    if (cacheFile) {
      fs.mkdirSync(cacheDir!, { recursive: true });
      const tmp = cacheFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(result));
      fs.renameSync(tmp, cacheFile);
    }
  }

  return {
    entityTypes: composeGated(observedEntityTypes, entityFold, result.entity_types ?? []),
    linkTypes: composeGated(observedLinkTypes, linkFold, result.link_types ?? []),
  };
}

/** Expand a name→count map into a flat name list (canonicalizeNames weighs by count). */
function expand(counts: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [n, c] of counts) for (let i = 0; i < c; i++) out.push(n);
  return out;
}

/** Make a fold total over the observed names (identity for anything not folded). */
function total(observed: Map<string, number>, fold: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of observed.keys()) out.set(n, fold.get(n) ?? n);
  return out;
}
