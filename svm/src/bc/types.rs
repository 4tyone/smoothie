//! The Rust serde mirror of `schema/bc.v1` (spec 02 · the BC contract).
//!
//! This is the **consumer half** of the seam: `schema/bc.v1.schema.json` is the
//! single source of truth (TS validates on write); these types mirror it and the
//! SVM validates on read. A breaking format change bumps `bc.v2` in `schema/` and
//! here in lockstep.
//!
//! The core (`sources`/`facts`/`graph`/`views`/`outlines`/`glossary`/`notes`/
//! `fidelity`/provenance) is **profile-blind**. `Action`/`Locator`/`Check` and
//! `manifest.app` are the **web-app profile's** payload; other profiles carry
//! their payload under `extensions` (spec 02 · target profiles).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The schema-version string every `bc.v1` file declares (spec 02 · file vs. version).
pub const SCHEMA_VERSION: &str = "bc.v1";

/// The web-app reference profile, whose vocabulary is baked into the core types
/// (`Action`/`Locator`/`Check`). Non-empty-locator gates apply only to it.
pub const PROFILE_WEB_APP: &str = "web-app";

/// One versioned BC: a single layered JSON control file (spec 02).
///
/// `deny_unknown_fields` enforces spec 02's "unknown top-level fields are invalid;
/// never ad hoc top-level fields" — additions live under `extensions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bc {
    /// Schema version, e.g. `"bc.v1"`. A consumer refuses one it doesn't understand.
    pub schema: String,
    pub manifest: Manifest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief: Option<Brief>,
    #[serde(default)]
    pub sources: BTreeMap<String, Source>,
    #[serde(default)]
    pub facts: BTreeMap<String, Fact>,
    #[serde(default)]
    pub graph: Graph,
    #[serde(default)]
    pub views: BTreeMap<String, View>,
    #[serde(default)]
    pub outlines: BTreeMap<String, Outline>,
    #[serde(default)]
    pub glossary: BTreeMap<String, GlossaryEntry>,
    #[serde(default)]
    pub notes: BTreeMap<String, Note>,
    #[serde(default)]
    pub cache: Cache,
    #[serde(default)]
    pub policy: Policy,
    #[serde(default)]
    pub extensions: Extensions,
}

// ─── Fidelity ────────────────────────────────────────────────────────────────

/// Honest trust per fact/node/edge/view/outline — the upgrade ladder (spec 02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fidelity {
    /// Verified against ground truth by a Resolver; checks evaluated.
    Confirmed,
    /// Asserted by a source document, not verified.
    Claimed,
    /// Weak/implied evidence; lowest trust.
    Guessed,
    /// Required but not found → a gap; never faked.
    Absent,
}

impl Fidelity {
    /// Trust rank for the "outlines don't launder trust" gate (higher = more trusted).
    pub fn rank(self) -> u8 {
        match self {
            Fidelity::Confirmed => 3,
            Fidelity::Claimed => 2,
            Fidelity::Guessed => 1,
            Fidelity::Absent => 0,
        }
    }

    /// `confirmed` is the only fidelity that demands a Resolver resolution receipt.
    pub fn requires_resolution_receipt(self) -> bool {
        matches!(self, Fidelity::Confirmed)
    }
}

// ─── Manifest ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub bc_id: String,
    /// Target profile, e.g. `"web-app" | "codebase" | "corpus"` (spec 02).
    pub profile: String,
    /// Web-app profile target identity; absent for non-app profiles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<AppIdentity>,
    pub producer: Producer,
    pub created_at: String,
    pub updated_at: String,
    pub counts: Counts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorship: Option<Authorship>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_origins: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Producer {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Counts {
    pub sources: u64,
    pub facts: u64,
    pub nodes: u64,
    pub edges: u64,
    pub views: u64,
    pub outlines: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Authorship {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

// ─── Brief ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Brief {
    pub brief_id: String,
    pub text: String,
    #[serde(default)]
    pub goals: Vec<Goal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<BriefScope>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_when: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BriefScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
}

// ─── Sources ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub source_id: String,
    /// The Reader's modality tag (spec 04), e.g. `"video"|"pdf"|"markdown"|…`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(default)]
    pub companions: Vec<Companion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Companion {
    pub kind: CompanionKind,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_span: Option<SourceSpan>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanionKind {
    Transcript,
    Frame,
    Screenshot,
    Dom,
    Ax,
    Audio,
    Other,
}

// ─── Facts ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fact {
    pub fact_id: String,
    pub kind: FactKind,
    pub text: String,
    /// 0..1 — the Reader's honest self-assessment.
    pub confidence: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    pub fidelity: Fidelity,
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brief_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_draft: Option<ActionDraft>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactKind {
    Knowledge,
    Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDraft {
    pub verb: Verb,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_effect: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verb {
    Goto,
    Click,
    Fill,
    Select,
    Press,
    Scroll,
    WaitFor,
    Unknown,
}

// ─── Graph ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Graph {
    #[serde(default)]
    pub nodes: BTreeMap<String, Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roots: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    /// Profile vocabulary — web-app: `"screen"|"feature"|"flow"|"action"`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    #[serde(default)]
    pub fact_ids: Vec<String>,
    /// Web-app profile payload; other profiles use `extensions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    #[serde(default)]
    pub checks: Vec<Check>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_when: Option<String>,
    pub fidelity: Fidelity,
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
    /// Confidentiality (spec 06 · §2): a free-text caution surfaced on every read
    /// of this node (e.g. "unaudited — verify before quoting").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
    /// Read restriction (spec 06 · §2): when true the SVM withholds this node's
    /// content (summary + fact text) on read unless the caller is authorized
    /// (`--reveal`). Enforcement is CODE — the flag is inert data, never a command.
    #[serde(default, skip_serializing_if = "is_false")]
    pub restricted: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Edges are claims too — honest trust on the connection (spec 02).
    pub fidelity: Fidelity,
    #[serde(default)]
    pub source_refs: Vec<SourceRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Contains,
    Transition,
    Enables,
    DependsOn,
    Next,
    RelatedTo,
}

// ─── Action / Locator / Check (web-app profile payload) ──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Goto { url: String },
    Click { locator: Locator },
    Fill { locator: Locator, value: String },
    Select { locator: Locator, value: String },
    Press { key: String },
    Scroll {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locator: Option<Locator>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<ScrollTarget>,
    },
    WaitFor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locator: Option<Locator>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        condition: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrollTarget {
    Element,
    Top,
    Bottom,
}

/// A re-resolvable locator strategy, not one brittle selector (spec 02).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Locator {
    pub description: String,
    pub primary: LocatorStrategy,
    #[serde(default)]
    pub fallbacks: Vec<LocatorStrategy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocatorStrategy {
    pub by: LocatorBy,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocatorBy {
    Role,
    Testid,
    Label,
    Text,
    Css,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Check {
    Visible { locator: Locator },
    Exists { locator: Locator },
    TextMatches {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        locator: Option<Locator>,
        expected: String,
    },
    UrlMatches { expected: String },
}

// ─── Views ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct View {
    pub view_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_patterns: Option<Vec<String>>,
    #[serde(default)]
    pub node_ids: Vec<String>,
    pub fidelity: Fidelity,
    #[serde(default)]
    pub observations: Vec<Observation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub observation_id: String,
    pub source_ref: SourceRef,
    pub url: String,
    pub captured_at: String,
    pub mode: Mode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ax_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dom_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    ReadOnly,
    DryRun,
    Live,
}

// ─── Outlines ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Outline {
    pub outline_id: String,
    pub brief_id: String,
    pub title: String,
    #[serde(default)]
    pub scenes: Vec<Scene>,
    pub fidelity: Fidelity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub scene_id: String,
    pub title: String,
    #[serde(default)]
    pub node_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_when: Option<String>,
    pub fidelity: Fidelity,
    /// Note keys, usually `gap:*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gaps: Option<Vec<String>>,
}

// ─── Provenance: SourceRef / SourceSpan ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub source_id: String,
    pub span: SourceSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceSpan {
    Time { t_start: f64, t_end: f64 },
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
    /// Web-app resolution receipt.
    Crawl {
        page_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    /// Web-app resolution receipt.
    Live { note: String },
    /// Generic Resolver receipt (any profile, spec 08).
    Resolve {
        resolver: String,
        #[serde(rename = "ref")]
        reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
}

impl SourceSpan {
    /// A resolution receipt is what makes `confirmed` honest (spec 02 · guarantee #2):
    /// `crawl`/`live` (web-app) or a generic `resolve` span. Documentary spans
    /// (`time`/`doc`) never confer `confirmed`.
    pub fn is_resolution_receipt(&self) -> bool {
        matches!(
            self,
            SourceSpan::Crawl { .. } | SourceSpan::Live { .. } | SourceSpan::Resolve { .. }
        )
    }
}

// ─── Glossary / Notes (substrate sections) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<String>>,
}

/// A durable observation. `gap:*` keys carry knowledge/action gaps (spec 02).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub text: String,
    /// For `gap:*` notes: `"knowledge"` | `"action"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default)]
    pub refs: Vec<SourceRef>,
}

// ─── Cache (substrate section, extended) ─────────────────────────────────────

/// Hot/trending/shadow graph slices + promotion state. Kept permissive in v1;
/// the substrate owns its detailed shape (spec 05).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cache {
    #[serde(default)]
    pub hot: Vec<serde_json::Value>,
    #[serde(default)]
    pub trending: Vec<serde_json::Value>,
    #[serde(default)]
    pub shadow: Vec<serde_json::Value>,
    #[serde(flatten, default)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// ─── Policy (spec 06) ────────────────────────────────────────────────────────

/// The embedded execution policy (web-app profile). A non-executable profile
/// leaves it empty and relies on the SVM's deny-by-default floor (spec 06).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Policy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<PolicyScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actions: Option<PolicyActions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<Budget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<Approval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secrets: Option<Secrets>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyScope {
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub url_denylist: Vec<String>,
    #[serde(default)]
    pub same_origin_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyActions {
    #[serde(default)]
    pub blocklist_verbs: Vec<String>,
    #[serde(default)]
    pub allow_irreversible: bool,
    #[serde(default)]
    pub allow_form_submit: bool,
    #[serde(default)]
    pub allow_rules: Vec<AllowRule>,
    #[serde(default)]
    pub danger: Vec<DangerRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowRule {
    #[serde(rename = "match")]
    pub pattern: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DangerRule {
    #[serde(rename = "match")]
    pub pattern: String,
    pub level: DangerLevel,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DangerLevel {
    Block,
    Approve,
    Supervise,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_actions: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_pages: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Approval {
    pub require_for: ApprovalScope,
    pub handler: ApprovalHandler,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalScope {
    None,
    Irreversible,
    AllMutations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalHandler {
    Interactive,
    PolicyOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Secrets {
    #[serde(default)]
    pub redact_patterns: Vec<String>,
}

// ─── Extensions ──────────────────────────────────────────────────────────────

/// Namespaced add-ons; keys must be reverse-DNS (spec 02), e.g.
/// `com.smoothie.reader.video`. The only place reader/target-specific payloads live.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Extensions(pub serde_json::Map<String, serde_json::Value>);
