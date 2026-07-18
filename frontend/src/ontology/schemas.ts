// Producer-side Valibot schemas for the ontology track — the shapes the `model`
// and `resolve` stages emit, mirroring `ontology.v1` (spec 01). Two layers, the
// same discipline as `bc/schemas.ts`:
//
//   • STRICT contract shapes — what code materializes into `ontology.json`. The
//     Rust SVM re-validates the strict shape on read (gates G1-G7).
//   • TOLERANT proposal shapes — what the model returns. The model proposes; code
//     owns the contract. A field the model gets slightly wrong (an off-enum
//     value_kind, a missing status) must not reject the whole proposal — each
//     falls back to a safe default, and code assigns ids/provenance/status.
//
// Net-new for the ontology track (spec 09 §2); wired into the pipeline in Phase 2/3.

import * as v from "valibot";

// ─── shared enums (spec 01 §4/§5/§6) ─────────────────────────────────────────
export const Fidelity = v.picklist(["confirmed", "claimed", "guessed", "absent", "derived"]);
export const FactKind = v.picklist(["knowledge", "action"]);
export const ValueKind = v.picklist(["string", "number", "boolean", "date", "geopoint", "enum", "ref"]);
export const Cardinality = v.picklist(["one", "many"]);
export const LinkCardinality = v.picklist(["one_to_one", "one_to_many", "many_to_many"]);
export const TypeStatus = v.picklist(["open", "closed"]);
export const EntityStatus = v.picklist(["active", "orphan"]);
export const Method = v.picklist(["agent", "agent+verified"]);
export const VerifiedBy = v.picklist(["judge", "human"]);

// ─── provenance / receipts ───────────────────────────────────────────────────
export const SourceSpan = v.variant("kind", [
  v.object({ kind: v.literal("time"), t_start: v.number(), t_end: v.number() }),
  v.object({ kind: v.literal("doc"), page: v.optional(v.number()), section: v.optional(v.string()), lines: v.optional(v.tuple([v.number(), v.number()])), label: v.optional(v.string()) }),
  v.object({ kind: v.literal("crawl"), page_id: v.string(), url: v.optional(v.string()) }),
  v.object({ kind: v.literal("live"), note: v.string() }),
  v.object({ kind: v.literal("resolve"), resolver: v.string(), ref: v.string(), note: v.optional(v.string()) }),
]);
export const SourceRef = v.object({ source_id: v.string(), span: SourceSpan });
export const Provenance = v.object({
  fact_ids: v.optional(v.array(v.string()), []),
  source_ids: v.optional(v.array(v.string())),
});
export const Alias = v.object({ text: v.string(), source_id: v.string() });

// ─── STRICT contract shapes (materialized into ontology.json) ────────────────
export const PropSchema = v.object({
  value_kind: ValueKind,
  cardinality: Cardinality,
  ref_type_id: v.optional(v.string()),
  enum_values: v.optional(v.array(v.string())),
  required: v.boolean(),
  identity: v.boolean(),
});

export const EntityType = v.object({
  type_id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  property_schema: v.record(v.string(), PropSchema),
  provenance: Provenance,
  fidelity: Fidelity,
  status: TypeStatus,
  extends: v.optional(v.array(v.string())),
});
export type EntityType = v.InferOutput<typeof EntityType>;

export const PropertyValue = v.object({
  value: v.unknown(),
  fact_ids: v.optional(v.array(v.string()), []),
  fidelity: Fidelity,
  security_id: v.optional(v.string()),
});

export const Entity = v.object({
  entity_id: v.string(),
  type_id: v.string(),
  label: v.string(),
  aliases: v.optional(v.array(Alias), []),
  properties: v.optional(v.record(v.string(), v.array(PropertyValue)), {}),
  provenance: Provenance,
  security_id: v.optional(v.string()),
  resolved_from: v.optional(v.array(v.string())),
  merged_into: v.optional(v.string()),
  status: EntityStatus,
});
export type Entity = v.InferOutput<typeof Entity>;

export const LinkType = v.object({
  link_type_id: v.string(),
  name: v.string(),
  from_type_id: v.string(),
  to_type_id: v.string(),
  cardinality: LinkCardinality,
  directed: v.boolean(),
  description: v.optional(v.string()),
  provenance: Provenance,
  status: TypeStatus,
});

export const Link = v.object({
  link_id: v.string(),
  link_type_id: v.string(),
  from: v.string(),
  to: v.string(),
  properties: v.optional(v.record(v.string(), v.unknown())),
  provenance: Provenance,
  fidelity: Fidelity,
  security_id: v.optional(v.string()),
});

export const ResolutionEvidence = v.object({
  fact_ids: v.optional(v.array(v.string()), []),
  rationale: v.optional(v.string()),
});
export const Resolution = v.object({
  resolution_id: v.string(),
  canonical: v.string(),
  members: v.array(v.string()),
  evidence: ResolutionEvidence,
  confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  method: Method,
  verified_by: v.optional(VerifiedBy),
  created_in_version: v.optional(v.string()),
  reversible: v.boolean(),
});
export type Resolution = v.InferOutput<typeof Resolution>;

// ─── TOLERANT proposal shapes (model-facing; code owns ids/provenance/status) ─
export const ProposedPropSchema = v.object({
  value_kind: v.fallback(ValueKind, "string"),
  cardinality: v.fallback(Cardinality, "one"),
  ref_type_id: v.optional(v.string()),
  enum_values: v.optional(v.array(v.string())),
  required: v.fallback(v.boolean(), false),
  identity: v.fallback(v.boolean(), false),
});

export const ProposedEntityType = v.object({
  name: v.string(),
  description: v.nullish(v.string()),
  property_schema: v.optional(v.record(v.string(), ProposedPropSchema), {}),
  fidelity: v.fallback(Fidelity, "claimed"),
});

export const ProposedPropertyValue = v.object({
  value: v.unknown(),
  fact_ids: v.optional(v.array(v.string()), []),
  fidelity: v.fallback(Fidelity, "claimed"),
});

// A model-friendly, flat proposal shape (spec 03). Structured output conforms to this
// reliably at scale; code owns the contract — it assigns ids, derives types, tags
// aliases with their source, and materializes provenance. Kept deliberately simple
// (nested record/array shapes are unreliable to constrain).
export const ProposedEntity = v.object({
  /** The entity's type by NAME — code resolves it to a stable type_id. */
  type: v.optional(v.string(), "Topic"),
  label: v.string(),
  /** Surface names (plain strings) — code tags each with the entity's source. */
  aliases: v.optional(v.array(v.string()), []),
  /** Facts that evidence the entity's existence. */
  fact_ids: v.optional(v.array(v.string()), []),
});

export const ProposedLinkType = v.object({
  name: v.string(),
  from_type: v.string(),
  to_type: v.string(),
  cardinality: v.fallback(LinkCardinality, "many_to_many"),
  directed: v.fallback(v.boolean(), true),
  description: v.nullish(v.string()),
});

export const ProposedLink = v.object({
  link_type: v.optional(v.string(), "related_to"),
  /** Endpoint entities by label — code resolves to stable entity_ids (a link whose
   *  endpoints don't resolve is dropped). */
  from: v.optional(v.string(), ""),
  to: v.optional(v.string(), ""),
  fact_ids: v.optional(v.array(v.string()), []),
  fidelity: v.fallback(Fidelity, "guessed"),
});

export const ProposedResolution = v.object({
  /** Entity refs to merge (>=2) — code assigns canonical + resolution_id. */
  members: v.pipe(v.array(v.string()), v.minLength(2)),
  rationale: v.optional(v.string()),
  fact_ids: v.optional(v.array(v.string()), []),
  confidence: v.fallback(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.8),
});

/** What the `model` stage asks the model to return (spec 03). Types are derived from
 *  the entities' `type` names in code, so the model only proposes entities and links. */
export const ModelResult = v.object({
  entities: v.optional(v.array(ProposedEntity), []),
  links: v.optional(v.array(ProposedLink), []),
});
export type ModelResult = v.InferOutput<typeof ModelResult>;

/** What the `resolve` stage asks the model to return (spec 04). */
export const ResolveResult = v.object({
  resolutions: v.optional(v.array(ProposedResolution), []),
});
export type ResolveResult = v.InferOutput<typeof ResolveResult>;

// A single observed-name → canonical-name remap (spec 03 · vocabulary consolidation).
// `to` must be one of the observed names; code fails closed to identity otherwise.
export const NameMapping = v.object({
  from: v.string(),
  to: v.string(),
});

/** What the `canonicalize` stage asks the model to return: a consolidation of the
 *  observed type and relation vocabularies onto a smaller canonical set derived from
 *  the corpus's OWN names (never invented). Code owns the gate — a mapping whose
 *  target isn't an observed name is dropped (identity). */
export const CanonicalizeResult = v.object({
  entity_types: v.optional(v.array(NameMapping), []),
  link_types: v.optional(v.array(NameMapping), []),
});
export type CanonicalizeResult = v.InferOutput<typeof CanonicalizeResult>;
