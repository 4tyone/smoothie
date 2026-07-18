// @smoothie/schema — the `ontology.v1` contract types (spec 01).
//
// The single source of truth for the ontology-track seam: the TS frontend imports
// these and validates on write; the Rust SVM mirrors them with serde
// (`svm/src/ontology/types.rs`) and validates on read. A breaking change bumps
// `ontology.v2` here and in the Rust mirror in lockstep. Net-new for the ontology
// track, built alongside `bc.v1` until the default flip (spec 09 §2).

export const ONTOLOGY_SCHEMA_VERSION = "ontology.v1" as const;

// ─── Fidelity (spec 01 §4/§5/§6) ─────────────────────────────────────────────
export type OntologyFidelity = "confirmed" | "claimed" | "guessed" | "absent" | "derived";
export type OntologyFactKind = "knowledge" | "action";

// ─── Provenance / receipts ───────────────────────────────────────────────────
export type OntologySourceSpan =
  | { kind: "time"; t_start: number; t_end: number }
  | { kind: "doc"; page?: number; section?: string; lines?: [number, number]; label?: string }
  | { kind: "crawl"; page_id: string; url?: string }
  | { kind: "live"; note: string }
  | { kind: "resolve"; resolver: string; ref: string; note?: string };

export interface OntologySourceRef {
  source_id: string;
  span: OntologySourceSpan;
}

/** Grounding: the facts (and, for entities, sources) that justify an object. */
export interface Provenance {
  fact_ids: string[];
  source_ids?: string[];
}

// ─── Manifest / brief / sources (spec 01 §2/§3) ──────────────────────────────
export interface OntologyManifest {
  ontology_id: string;
  schema?: "ontology.v1";
  producer_version?: string;
  profile: string;
  created_at?: string;
  authorship?: { author?: string; organization?: string };
  counts?: Record<string, number>;
}

export interface OntologyBrief {
  brief_id: string;
  intent?: string;
  goals?: unknown[];
  created_at?: string;
}

export interface OntologySource {
  source_id: string;
  kind: string;
  path?: string;
  uri?: string;
  hash?: string;
  companions?: unknown[];
}

// ─── Facts (spec 01 §4) ──────────────────────────────────────────────────────
export interface OntologyFact {
  fact_id: string;
  kind: OntologyFactKind;
  text: string;
  confidence: number;
  fidelity: OntologyFidelity;
  source_refs: OntologySourceRef[];
  brief_id?: string;
  view_id?: string;
}

// ─── Entity types and entities (spec 01 §5) ──────────────────────────────────
export type ValueKind = "string" | "number" | "boolean" | "date" | "geopoint" | "enum" | "ref";
export type Cardinality = "one" | "many";
export type TypeStatus = "open" | "closed";
export type EntityStatus = "active" | "orphan";

export interface PropSchema {
  value_kind: ValueKind;
  cardinality: Cardinality;
  ref_type_id?: string;
  enum_values?: string[];
  required: boolean;
  identity: boolean;
}

export interface EntityType {
  type_id: string;
  name: string;
  description?: string;
  property_schema: Record<string, PropSchema>;
  provenance: Provenance;
  fidelity: OntologyFidelity;
  status: TypeStatus;
  extends?: string[];
}

export interface PropertyValue {
  value: unknown;
  fact_ids: string[];
  fidelity: OntologyFidelity;
  security_id?: string;
}

export interface Alias {
  text: string;
  source_id: string;
}

export interface Entity {
  entity_id: string;
  type_id: string;
  label: string;
  aliases: Alias[];
  properties: Record<string, PropertyValue[]>;
  provenance: Provenance;
  security_id?: string;
  resolved_from?: string[];
  merged_into?: string;
  status: EntityStatus;
}

// ─── Link types and links (spec 01 §6) ───────────────────────────────────────
export type LinkCardinality = "one_to_one" | "one_to_many" | "many_to_many";

export interface LinkType {
  link_type_id: string;
  name: string;
  from_type_id: string;
  to_type_id: string;
  cardinality: LinkCardinality;
  directed: boolean;
  description?: string;
  provenance: Provenance;
  status: TypeStatus;
}

export interface Link {
  link_id: string;
  link_type_id: string;
  from: string;
  to: string;
  properties?: Record<string, unknown>;
  provenance: Provenance;
  fidelity: OntologyFidelity;
  security_id?: string;
}

// ─── Resolutions (spec 01 §7) ────────────────────────────────────────────────
export type ResolutionMethod = "agent" | "agent+verified";
export type ResolutionVerifiedBy = "judge" | "human";

export interface Resolution {
  resolution_id: string;
  canonical: string;
  members: string[];
  evidence: { fact_ids: string[]; rationale?: string };
  confidence: number;
  method: ResolutionMethod;
  verified_by?: ResolutionVerifiedBy;
  created_in_version?: string;
  reversible: boolean;
}

// ─── Versioning + determinism envelope (spec 01 §9, spec 05 §5) ──────────────
export interface Envelope {
  source_hashes: Record<string, string>;
  [k: string]: unknown;
}

export interface OntologyVersion {
  version_id: string;
  parent_version_id?: string;
  created_at?: string;
  envelope: Envelope;
  operations?: unknown[];
}

// ─── Glossary / policy ───────────────────────────────────────────────────────
export interface OntologyGlossaryEntry {
  definition: string;
  references?: string[];
}

export interface OntologyPolicy {
  security?: Record<string, unknown>;
  [k: string]: unknown;
}

// ─── Ontology (top level, spec 01 §1) ────────────────────────────────────────
export interface Ontology {
  schema: "ontology.v1";
  manifest: OntologyManifest;
  brief?: OntologyBrief;
  sources: Record<string, OntologySource>;
  facts: Record<string, OntologyFact>;
  entity_types: Record<string, EntityType>;
  entities: Record<string, Entity>;
  link_types: Record<string, LinkType>;
  links: Record<string, Link>;
  resolutions: Record<string, Resolution>;
  glossary?: Record<string, OntologyGlossaryEntry>;
  notes?: unknown[];
  policy?: OntologyPolicy;
  version: OntologyVersion;
  extensions?: Record<string, unknown>;
}
