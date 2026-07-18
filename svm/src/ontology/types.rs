//! The Rust serde mirror of `schema/ontology.v1` (spec 01 · the ontology contract).
//!
//! Consumer half of the seam: `schema/ontology.v1.schema.json` is the single source
//! of truth (the TS frontend validates on write); these types mirror it and the SVM
//! validates on read. A breaking format change bumps `ontology.v2` in `schema/` and
//! here in lockstep. Net-new for the ontology track, built alongside `bc` until the
//! default flip (spec 09 §2/§6.3).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The schema-version string every `ontology.v1` file declares (spec 01 §1).
pub const SCHEMA_VERSION: &str = "ontology.v1";

// ─── Ontology (top level, spec 01 §1) ────────────────────────────────────────

/// One versioned ontology: a single typed, entity-resolved, grounded artifact.
///
/// `deny_unknown_fields` enforces spec 01's "unknown top-level fields are invalid";
/// additions live under `extensions` (§10 forward-compat).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ontology {
    /// Schema version, e.g. `"ontology.v1"`. A consumer refuses one it doesn't understand.
    pub schema: String,
    pub manifest: Manifest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief: Option<Brief>,
    #[serde(default)]
    pub sources: BTreeMap<String, Source>,
    #[serde(default)]
    pub facts: BTreeMap<String, Fact>,
    #[serde(default)]
    pub entity_types: BTreeMap<String, EntityType>,
    /// §10 interfaces (post-core enrichment); empty when unused.
    #[serde(default)]
    pub interfaces: BTreeMap<String, Interface>,
    #[serde(default)]
    pub entities: BTreeMap<String, Entity>,
    #[serde(default)]
    pub link_types: BTreeMap<String, LinkType>,
    #[serde(default)]
    pub links: BTreeMap<String, Link>,
    #[serde(default)]
    pub resolutions: BTreeMap<String, Resolution>,
    /// The verb layer (spec 10 §1): processes/transformations. Additive; empty when unused.
    #[serde(default)]
    pub logic_units: BTreeMap<String, LogicUnit>,
    /// The verb layer: observed occurrences of logic units running (grounded deltas).
    #[serde(default)]
    pub events: BTreeMap<String, Event>,
    #[serde(default)]
    pub glossary: BTreeMap<String, GlossaryEntry>,
    #[serde(default)]
    pub notes: Vec<serde_json::Value>,
    #[serde(default)]
    pub policy: Policy,
    pub version: Version,
    #[serde(default)]
    pub extensions: Extensions,
}

// ─── Fidelity (spec 01 §4/§5/§6) ─────────────────────────────────────────────

/// Honest trust per fact/value/link/type. `derived` is a §10 enrichment; included
/// so the contract does not need a bump to carry computed values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fidelity {
    Confirmed,
    Claimed,
    Guessed,
    Absent,
    Derived,
}

// ─── Manifest (spec 01 §2) ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub ontology_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_version: Option<String>,
    pub profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorship: Option<Authorship>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<Counts>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Authorship {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
}

/// A code-computed rollup. Kept permissive (the exact keys evolve, spec 01 §2).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Counts {
    #[serde(flatten)]
    pub values: serde_json::Map<String, serde_json::Value>,
}

// ─── Brief (spec 01 §2, spec 07) ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Brief {
    pub brief_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<String>,
    #[serde(default)]
    pub goals: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    // seed_types / seed_links / glossary are steering hints (spec 07); ignored here.
}

// ─── Sources (spec 01 §3) ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub source_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default)]
    pub companions: Vec<serde_json::Value>,
}

// ─── Facts: the evidence layer (spec 01 §4) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fact {
    pub fact_id: String,
    pub kind: FactKind,
    pub text: String,
    /// 0..1 — enforced on read (G1) so a producer bug cannot smuggle an out-of-range value.
    pub confidence: f64,
    pub fidelity: Fidelity,
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactKind {
    Knowledge,
    Action,
}

// ─── Provenance / SourceRef / SourceSpan ─────────────────────────────────────

/// Grounding for a type/entity/link/value: the facts (and, for entities, sources)
/// that justify it. Every grounded object carries one (spec 01 §5-§7).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Provenance {
    #[serde(default)]
    pub fact_ids: Vec<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub source_id: String,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceSpan {
    Time {
        t_start: f64,
        t_end: f64,
    },
    Doc {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        page: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        section: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lines: Option<[u32; 2]>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    Crawl {
        page_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    Live {
        note: String,
    },
    Resolve {
        resolver: String,
        #[serde(rename = "ref")]
        reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
}

// ─── Entity types and entities (spec 01 §5) ──────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueKind {
    String,
    Number,
    Boolean,
    Date,
    Geopoint,
    Enum,
    Ref,
    /// §10 composite value: an object of named sub-fields (see `struct_fields`).
    Struct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Cardinality {
    One,
    Many,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropSchema {
    pub value_kind: ValueKind,
    pub cardinality: Cardinality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_type_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub identity: bool,
    // ─── §10 enrichments (all optional; a plain property uses none) ───
    /// A reducer selects the head value shown by default for a `cardinality: many`
    /// property; the full list stays queryable (spec 01 §10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reducer: Option<Reducer>,
    /// A derived property is computed by the consumer over links, never stored
    /// (spec 01 §10). Read-only; its values carry `fidelity: derived`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived: Option<Derived>,
    /// For `value_kind: struct`, the declared sub-field schema (spec 01 §10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub struct_fields: Option<BTreeMap<String, StructField>>,
    /// For a struct, the field that behaves as the value in query/display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub struct_main: Option<String>,
}

/// A reducer rule for a `cardinality: many` property (spec 01 §10). Deterministic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reducer {
    /// `first` | `last` | `max` | `min` | `most_recent` (`most_recent` needs `by`).
    pub rule: String,
    /// Ordering key for `most_recent` (a sibling property or struct field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

/// A derived property definition (spec 01 §10): traverse links, aggregate a target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Derived {
    /// Follow links of this type (or any if absent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_type: Option<String>,
    /// `out` | `in` | `both` (default `both`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// `count` | `collect_list` | `sum` — how to aggregate over the neighborhood.
    pub aggregation: String,
    /// The neighbor property to aggregate (required for collect_list / sum).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub of: Option<String>,
}

/// One field of a struct value's declared schema (spec 01 §10).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructField {
    pub value_kind: ValueKind,
    #[serde(default)]
    pub required: bool,
}

/// An interface: a property schema entity types can implement (spec 01 §10).
/// Multi-inheritance and multi-level via `extends`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interface {
    pub interface_id: String,
    pub name: String,
    #[serde(default)]
    pub property_schema: BTreeMap<String, PropSchema>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<Vec<String>>,
}

/// open/closed lifecycle (spec 05 §3). A `closed` type is frozen for modification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Open,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityType {
    pub type_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub property_schema: BTreeMap<String, PropSchema>,
    #[serde(default)]
    pub provenance: Provenance,
    pub fidelity: Fidelity,
    pub status: Status,
    /// §10 interfaces (post-core); validated when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyValue {
    pub value: serde_json::Value,
    #[serde(default)]
    pub fact_ids: Vec<String>,
    pub fidelity: Fidelity,
    /// Per-value security (enables sub-cell security, §10). Must resolve under G6.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    pub text: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityStatus {
    Active,
    Orphan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub entity_id: String,
    pub type_id: String,
    pub label: String,
    #[serde(default)]
    pub aliases: Vec<Alias>,
    #[serde(default)]
    pub properties: BTreeMap<String, Vec<PropertyValue>>,
    #[serde(default)]
    pub provenance: Provenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_id: Option<String>,
    /// Set when this is a canonical entity: the members it absorbed (spec 01 §7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_from: Option<Vec<String>>,
    /// Set on a member entity: the canonical it merged into (spec 01 §7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_into: Option<String>,
    pub status: EntityStatus,
}

// ─── Link types and links (spec 01 §6) ───────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkCardinality {
    OneToOne,
    OneToMany,
    ManyToMany,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkType {
    pub link_type_id: String,
    pub name: String,
    /// Declared endpoint entity types, or `"*"` for any.
    pub from_type_id: String,
    pub to_type_id: String,
    pub cardinality: LinkCardinality,
    #[serde(default)]
    pub directed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub provenance: Provenance,
    pub status: Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub link_id: String,
    pub link_type_id: String,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub properties: Option<serde_json::Value>,
    #[serde(default)]
    pub provenance: Provenance,
    pub fidelity: Fidelity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_id: Option<String>,
}

// ─── Resolutions (spec 01 §7) ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Method {
    #[serde(rename = "agent")]
    Agent,
    #[serde(rename = "agent+verified")]
    AgentVerified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerifiedBy {
    Judge,
    Human,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResolutionEvidence {
    #[serde(default)]
    pub fact_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resolution {
    pub resolution_id: String,
    pub canonical: String,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub evidence: ResolutionEvidence,
    pub confidence: f64,
    pub method: Method,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_by: Option<VerifiedBy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_in_version: Option<String>,
    #[serde(default)]
    pub reversible: bool,
}

// ─── Verb layer: logic units and events (spec 10 §1-§2) ──────────────────────

/// The three evidence classes a logic unit is mapped from (spec 10 §2). Kept
/// distinct because they have different trust and failure modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceClass {
    /// The official process (SOPs, policy docs). Authoritative in intent.
    DeJure,
    /// The process as actually executed (logs, event feeds). Real, silicon-legible.
    DeFacto,
    /// What people say they do (interviews, elicited testimony). Fills tacit gaps.
    Espoused,
}

/// One piece of evidence for a step, tagged by class (spec 10 §2). `de_facto`
/// evidence points at events; `de_jure`/`espoused` at a source document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub class: EvidenceClass,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default)]
    pub event_ids: Vec<String>,
    /// This evidence contradicts the step as documented (a conflict, spec 10 §2).
    #[serde(default)]
    pub contradicts: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// One step of a logic unit's inferred contract, with its multi-class evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicStep {
    pub step_id: String,
    pub text: String,
    #[serde(default)]
    pub evidence: Vec<EvidenceRef>,
}

/// `observed` (mapped from evidence) or `executable` (promoted, spec 10 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogicUnitState {
    Observed,
    Executable,
}

/// A logic unit's implementation class (spec 10 §1): `derived` (deterministic,
/// groundable) or `judged` (an LLM logic unit; stochastic, its output not a fact).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrustClass {
    Derived,
    Judged,
}

/// A logic unit: a repeatable process/transformation (the organization's analogue of
/// a function), mapped descriptively in this phase (spec 10 §1-§2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicUnit {
    pub logic_unit_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub state: LogicUnitState,
    pub trust_class: TrustClass,
    #[serde(default)]
    pub steps: Vec<LogicStep>,
    #[serde(default)]
    pub provenance: Provenance,
    /// The executable contract, bound on promotion (spec 10 §4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<ExecutableContract>,
}

/// The bound executable contract (spec 10 §4): inputs, outputs, the kinetic surface
/// (`restrictions`), the action's reversibility and blast radius (which set the
/// autonomy floor, G9), and the disposition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutableContract {
    #[serde(default)]
    pub inputs: Vec<serde_json::Value>,
    #[serde(default)]
    pub outputs: Vec<ContractOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restrictions: Option<Restrictions>,
    /// `reversible` | `irreversible` | `unknown` (unknown is treated as irreversible).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reversibility: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blast_radius: Option<BlastRadius>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disposition: Option<Disposition>,
    /// The de-facto-attested steps at promotion time — the frozen baseline the
    /// conformance loop measures drift against (spec 10 §6).
    #[serde(default)]
    pub baseline_steps: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractOutput {
    pub name: String,
    /// The type/entity this output writes to (must be within `restrictions.writes`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writes: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// The bounded kinetic surface (spec 10 §4, spec 08 §6). Enforcement is fail-closed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Restrictions {
    #[serde(default)]
    pub reads: Vec<String>,
    #[serde(default)]
    pub writes: Vec<String>,
    #[serde(default)]
    pub forbid: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadius {
    #[serde(default)]
    pub entities: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Disposition {
    #[serde(default)]
    pub requested: String,
    #[serde(default)]
    pub floor: String,
    #[serde(default)]
    pub effective: String,
}

/// An event: one observed occurrence of a logic unit running, grounded by a receipt
/// (a log line / transaction). Events are how the de facto process is observed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_id: String,
    pub logic_unit_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

// ─── Glossary (spec 01 §1) ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<String>>,
}

// ─── Policy: layered security (spec 01 §10, spec 06) ─────────────────────────

/// Named security policies referenced by `security_id`. Enforcement is code (G6);
/// the entries here are inert data, never commands.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Policy {
    #[serde(default)]
    pub security: BTreeMap<String, serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ─── Versioning + determinism envelope (spec 01 §9, spec 05 §5) ──────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default)]
    pub envelope: Envelope,
    #[serde(default)]
    pub operations: Vec<serde_json::Value>,
}

/// The pinned inputs sufficient to reproduce or diff a build (G7, spec 05 §5):
/// source hashes are load-bearing; other keys (models, prompt versions, resolver
/// config) are carried permissively so the envelope can grow without a bump.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Envelope {
    #[serde(default)]
    pub source_hashes: BTreeMap<String, String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ─── Extensions (spec 01 §1) ─────────────────────────────────────────────────

/// Namespaced add-ons; keys must be reverse-DNS. The only place off-contract
/// payloads live.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Extensions(pub serde_json::Map<String, serde_json::Value>);
