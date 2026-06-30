// Resolver registry + selection (spec 08 · selection & ordering). `resolve` picks
// the Resolvers registered for the BC's `manifest.profile` and runs the cheapest
// applicable ones first (re-examine, cross-source) before any expensive live one.
//
// v1 ships this registry with the deterministic, offline Resolvers below. The
// **web-app live crawler** (the reference Resolver, ground truth = the live DOM)
// is NOT registered here: it needs a live target URL + a browser stack + the full
// safety floor enforced during the crawl (spec 06/08). It plugs in the same way —
// `register(webAppCrawler)` — once a target and browser backend are provided.

import type { Resolver } from "./types.ts";
import { reExamineResolver } from "./re-examine.ts";
import { crossSourceResolver } from "./cross-source.ts";

/** Cheapest-first (spec 08): re-examine, then cross-source. */
const REGISTRY: Resolver[] = [reExamineResolver, crossSourceResolver];

export function allResolvers(): Resolver[] {
  return REGISTRY;
}

/** Resolvers that apply to a profile and were requested by name (Brief/CLI). */
export function selectResolvers(profile: string, requested: string[]): Resolver[] {
  const want = new Set(requested);
  return REGISTRY.filter((r) => want.has(r.name) && (r.profile === "*" || r.profile === profile));
}
