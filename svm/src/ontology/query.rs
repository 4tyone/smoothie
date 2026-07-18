//! The typed, model-free query surface over an `ontology.v1` (spec 06 §2-§4).
//!
//! Deterministic, structured operations over a loaded ontology: list types and
//! entities, get an entity with its grounded properties and receipts, follow typed
//! links, traverse, resolve (the resolution graph), search, and surface gaps. Every
//! answer is a pure function of the ontology and carries **receipts** (spec 06 §4):
//! the SVM has no model and interprets nothing.
//!
//! Two read-time behaviors realize the contract:
//!   - **Resolution union** (spec 01 §7): querying a canonical entity returns the
//!     union of its members' aliases and property values, each value keeping its own
//!     provenance and security (security multiplicity).
//!   - **Fail-closed security** (spec 06 §6, gate G6): a value carrying a
//!     `security_id` (its own or its entity's) is WITHHELD in code unless the caller
//!     passes `--reveal`. Existence, ids, and receipts stay visible (auditable).

use std::collections::{BTreeMap, VecDeque};

use serde::Serialize;

use crate::error::{Result, SmoothieError};
use crate::ontology::types::*;

const WITHHELD: &str = "[restricted — content withheld; pass --reveal if authorized]";

// ─── receipts ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ReceiptView {
    pub source_id: String,
    pub resolved: bool,
    pub source_kind: Option<String>,
    pub span: SourceSpan,
}

fn receipts_for_facts(ont: &Ontology, fact_ids: &[String]) -> Vec<ReceiptView> {
    let mut out = Vec::new();
    for fid in fact_ids {
        if let Some(f) = ont.facts.get(fid) {
            for sr in &f.source_refs {
                let src = ont.sources.get(&sr.source_id);
                out.push(ReceiptView {
                    source_id: sr.source_id.clone(),
                    resolved: src.is_some(),
                    source_kind: src.map(|s| s.kind.clone()),
                    span: sr.span.clone(),
                });
            }
        }
    }
    out
}

// ─── types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TypeView {
    pub type_id: String,
    pub name: String,
    pub status: Status,
    pub property_count: usize,
    pub entity_count: usize,
}

pub fn types(ont: &Ontology) -> Vec<TypeView> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for e in ont.entities.values() {
        *counts.entry(e.type_id.as_str()).or_default() += 1;
    }
    let mut out: Vec<TypeView> = ont
        .entity_types
        .values()
        .map(|t| TypeView {
            type_id: t.type_id.clone(),
            name: t.name.clone(),
            status: t.status,
            property_count: t.property_schema.len(),
            entity_count: *counts.get(t.type_id.as_str()).unwrap_or(&0),
        })
        .collect();
    out.sort_by(|a, b| a.type_id.cmp(&b.type_id));
    out
}

// ─── entity summaries / list / search ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct EntitySummary {
    pub entity_id: String,
    pub type_id: String,
    pub type_name: Option<String>,
    pub label: String,
    pub status: EntityStatus,
    pub alias_count: usize,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restricted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_into: Option<String>,
}

fn summary(ont: &Ontology, e: &Entity) -> EntitySummary {
    EntitySummary {
        entity_id: e.entity_id.clone(),
        type_id: e.type_id.clone(),
        type_name: ont.entity_types.get(&e.type_id).map(|t| t.name.clone()),
        label: e.label.clone(),
        status: e.status,
        alias_count: e.aliases.len(),
        restricted: e.security_id.is_some(),
        merged_into: e.merged_into.clone(),
    }
}

pub fn entities(ont: &Ontology, type_filter: Option<&str>, interface_filter: Option<&str>) -> Vec<EntitySummary> {
    let mut out: Vec<EntitySummary> = ont
        .entities
        .values()
        .filter(|e| type_filter.is_none_or(|t| e.type_id == t || ont.entity_types.get(&e.type_id).is_some_and(|et| et.name == t)))
        .filter(|e| {
            interface_filter.is_none_or(|i| {
                let ids = interface_ids_of(ont, &e.type_id);
                ids.contains(i) || ont.interfaces.values().any(|f| f.name == i && ids.contains(&f.interface_id))
            })
        })
        .map(|e| summary(ont, e))
        .collect();
    out.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    out
}

/// Search entities whose label or any alias contains `term` (case-insensitive).
pub fn search(ont: &Ontology, term: &str) -> Vec<EntitySummary> {
    let q = term.to_lowercase();
    let mut out: Vec<EntitySummary> = ont
        .entities
        .values()
        .filter(|e| e.label.to_lowercase().contains(&q) || e.aliases.iter().any(|a| a.text.to_lowercase().contains(&q)))
        .map(|e| summary(ont, e))
        .collect();
    out.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    out
}

// ─── entity (full, with resolution union + security) ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PropertyValueView {
    pub value: serde_json::Value,
    pub fidelity: Fidelity,
    pub receipts: Vec<ReceiptView>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub withheld: bool,
    /// Which entity contributed this value (self, or a resolved member).
    pub from_entity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AliasView {
    pub text: String,
    pub source_id: String,
    pub from_entity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntityView {
    pub entity_id: String,
    pub type_id: String,
    pub type_name: Option<String>,
    pub label: String,
    pub status: EntityStatus,
    pub aliases: Vec<AliasView>,
    pub properties: BTreeMap<String, Vec<PropertyValueView>>,
    pub receipts: Vec<ReceiptView>,
    /// The members this canonical entity absorbed (spec 01 §7), if any.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub resolved_from: Vec<String>,
    /// The canonical this entity merged into, if it is a member.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_into: Option<String>,
    /// Default display value per property (reducer head or struct main field, §10).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub heads: BTreeMap<String, serde_json::Value>,
    /// Computed derived properties (§10), evaluated over links at read time.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub derived: BTreeMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub restricted: bool,
}

/// Get one entity with the resolution union applied and security enforced (spec 06).
pub fn entity(ont: &Ontology, id: &str, reveal: bool) -> Result<EntityView> {
    let e = ont
        .entities
        .get(id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("entity {id:?}")))?;

    // The union set: the entity itself, plus its resolved members (if canonical).
    let members: Vec<&Entity> = e
        .resolved_from
        .clone()
        .unwrap_or_default()
        .iter()
        .filter_map(|m| ont.entities.get(m))
        .collect();
    let contributors: Vec<&Entity> = std::iter::once(e).chain(members.iter().copied()).collect();

    let entity_restricted = e.security_id.is_some();

    let mut aliases: Vec<AliasView> = Vec::new();
    let mut properties: BTreeMap<String, Vec<PropertyValueView>> = BTreeMap::new();
    let mut receipts: Vec<ReceiptView> = Vec::new();
    // Raw union values per property (value, was-restricted), for reducer/struct heads.
    let mut raw: BTreeMap<String, Vec<(serde_json::Value, bool)>> = BTreeMap::new();

    for c in &contributors {
        for a in &c.aliases {
            aliases.push(AliasView { text: a.text.clone(), source_id: a.source_id.clone(), from_entity: c.entity_id.clone() });
        }
        receipts.extend(receipts_for_facts(ont, &c.provenance.fact_ids));
        for (pname, vals) in &c.properties {
            let bucket = properties.entry(pname.clone()).or_default();
            let raw_bucket = raw.entry(pname.clone()).or_default();
            for v in vals {
                // Security multiplicity: a value is withheld if it OR its owning
                // entity carries a security_id and the caller is not authorized.
                let restricted = v.security_id.is_some() || c.security_id.is_some();
                let withheld = restricted && !reveal;
                bucket.push(PropertyValueView {
                    value: if withheld { serde_json::Value::String(WITHHELD.to_string()) } else { v.value.clone() },
                    fidelity: v.fidelity,
                    receipts: receipts_for_facts(ont, &v.fact_ids),
                    withheld,
                    from_entity: c.entity_id.clone(),
                });
                raw_bucket.push((v.value.clone(), restricted));
            }
        }
    }
    aliases.sort_by(|a, b| (a.text.clone(), a.source_id.clone()).cmp(&(b.text.clone(), b.source_id.clone())));

    // §10 enrichments: reducer/struct-main heads and computed derived properties.
    let mut heads: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    let mut derived: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    if let Some(et) = ont.entity_types.get(&e.type_id) {
        for (pname, ps) in &et.property_schema {
            if let Some(d) = &ps.derived {
                derived.insert(pname.clone(), eval_derived(ont, &e.entity_id, d));
            } else if ps.reducer.is_some() || ps.struct_main.is_some() {
                if let Some(list) = raw.get(pname) {
                    if !list.is_empty() {
                        if list.iter().any(|(_, r)| *r) && !reveal {
                            heads.insert(pname.clone(), serde_json::Value::String(WITHHELD.to_string()));
                        } else {
                            let vals: Vec<serde_json::Value> = list.iter().map(|(v, _)| v.clone()).collect();
                            if let Some(h) = head_value(&vals, ps) {
                                heads.insert(pname.clone(), h);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(EntityView {
        entity_id: e.entity_id.clone(),
        type_id: e.type_id.clone(),
        type_name: ont.entity_types.get(&e.type_id).map(|t| t.name.clone()),
        label: e.label.clone(),
        status: e.status,
        aliases,
        properties,
        receipts,
        resolved_from: e.resolved_from.clone().unwrap_or_default(),
        merged_into: e.merged_into.clone(),
        heads,
        derived,
        restricted: entity_restricted,
    })
}

// ─── §10 enrichment evaluation (reducers, derived, interfaces) ───────────────

/// The default display value for a property: the struct main field of the first
/// value, or the reducer's head over the value list (spec 01 §10). Deterministic.
fn head_value(vals: &[serde_json::Value], ps: &PropSchema) -> Option<serde_json::Value> {
    if vals.is_empty() {
        return None;
    }
    if let Some(main) = &ps.struct_main {
        return vals[0].as_object().and_then(|o| o.get(main)).cloned();
    }
    let r = ps.reducer.as_ref()?;
    match r.rule.as_str() {
        "first" => vals.first().cloned(),
        "last" | "most_recent" => vals.last().cloned(),
        "max" => vals.iter().filter(|v| v.as_f64().is_some()).cloned().max_by(|a, b| a.as_f64().unwrap().partial_cmp(&b.as_f64().unwrap()).unwrap()),
        "min" => vals.iter().filter(|v| v.as_f64().is_some()).cloned().min_by(|a, b| a.as_f64().unwrap().partial_cmp(&b.as_f64().unwrap()).unwrap()),
        _ => None,
    }
}

/// Evaluate a derived property over an entity's link neighborhood (spec 01 §10).
fn eval_derived(ont: &Ontology, entity_id: &str, d: &Derived) -> serde_json::Value {
    let dir = d.direction.as_deref().unwrap_or("both");
    let mut neighbors: Vec<String> = Vec::new();
    for l in ont.links.values() {
        let touches = match dir {
            "out" => l.from == entity_id,
            "in" => l.to == entity_id,
            _ => l.from == entity_id || l.to == entity_id,
        };
        if !touches {
            continue;
        }
        if let Some(lt) = &d.link_type {
            if &l.link_type_id != lt {
                continue;
            }
        }
        neighbors.push(if l.from == entity_id { l.to.clone() } else { l.from.clone() });
    }
    neighbors.sort();
    neighbors.dedup();

    match d.aggregation.as_str() {
        "count" => serde_json::Value::from(neighbors.len()),
        "collect_list" => {
            let of = d.of.as_deref();
            let vals: Vec<serde_json::Value> = neighbors
                .iter()
                .filter_map(|n| ont.entities.get(n))
                .filter_map(|e| of.and_then(|p| e.properties.get(p)).and_then(|vs| vs.first()).map(|v| v.value.clone()))
                .collect();
            serde_json::Value::Array(vals)
        }
        "sum" => {
            let of = d.of.as_deref();
            let s: f64 = neighbors
                .iter()
                .filter_map(|n| ont.entities.get(n))
                .filter_map(|e| of.and_then(|p| e.properties.get(p)).and_then(|vs| vs.first()).and_then(|v| v.value.as_f64()))
                .sum();
            serde_json::Value::from(s)
        }
        _ => serde_json::Value::Null,
    }
}

/// The interfaces a type implements, transitively through interface `extends`.
fn interface_ids_of(ont: &Ontology, type_id: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    let mut stack: Vec<String> = ont.entity_types.get(type_id).and_then(|t| t.extends.clone()).unwrap_or_default();
    while let Some(iid) = stack.pop() {
        if !out.insert(iid.clone()) {
            continue;
        }
        if let Some(iface) = ont.interfaces.get(&iid) {
            if let Some(ext) = &iface.extends {
                stack.extend(ext.clone());
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct InterfaceView {
    pub interface_id: String,
    pub name: String,
    pub property_count: usize,
    pub implemented_by: Vec<String>,
}

// ─── verb layer: logic units + the conformance report (spec 10 §2) ───────────

fn state_str(s: LogicUnitState) -> &'static str {
    match s {
        LogicUnitState::Observed => "observed",
        LogicUnitState::Executable => "executable",
    }
}
fn trust_str(t: TrustClass) -> &'static str {
    match t {
        TrustClass::Derived => "derived",
        TrustClass::Judged => "judged",
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LogicUnitSummary {
    pub logic_unit_id: String,
    pub name: String,
    pub state: String,
    pub trust_class: String,
    pub step_count: usize,
    pub event_count: usize,
}

pub fn logic_units(ont: &Ontology) -> Vec<LogicUnitSummary> {
    let mut out: Vec<LogicUnitSummary> = ont
        .logic_units
        .values()
        .map(|lu| LogicUnitSummary {
            logic_unit_id: lu.logic_unit_id.clone(),
            name: lu.name.clone(),
            state: state_str(lu.state).to_string(),
            trust_class: trust_str(lu.trust_class).to_string(),
            step_count: lu.steps.len(),
            event_count: ont.events.values().filter(|e| e.logic_unit_id == lu.logic_unit_id).count(),
        })
        .collect();
    out.sort_by(|a, b| a.logic_unit_id.cmp(&b.logic_unit_id));
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct StepConformance {
    pub step_id: String,
    pub text: String,
    pub de_jure: bool,
    pub de_facto: bool,
    pub espoused: bool,
    pub conflict: bool,
    /// `confirmed` | `de_jure_only` (documented, not observed) | `de_facto_only`
    /// (observed, not documented) | `espoused_only` | `conflict` | `ungrounded`.
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ConformanceSummary {
    pub confirmed: usize,
    pub de_jure_only: usize,
    pub de_facto_only: usize,
    pub espoused_only: usize,
    pub conflict: usize,
    pub ungrounded: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogicUnitConformance {
    pub logic_unit_id: String,
    pub name: String,
    pub state: String,
    pub trust_class: String,
    pub steps: Vec<StepConformance>,
    pub summary: ConformanceSummary,
}

fn step_conformance(ont: &Ontology, lu: &LogicUnit, step: &LogicStep) -> StepConformance {
    let mut de_jure = false;
    let mut de_facto = false;
    let mut espoused = false;
    let mut conflict = false;
    for ev in &step.evidence {
        match ev.class {
            EvidenceClass::DeJure => de_jure = true,
            EvidenceClass::DeFacto => de_facto = true,
            EvidenceClass::Espoused => espoused = true,
        }
        if ev.contradicts {
            conflict = true;
        }
    }
    // Events attached to this step also attest the de facto process.
    if ont.events.values().any(|e| e.logic_unit_id == lu.logic_unit_id && e.step_id.as_deref() == Some(step.step_id.as_str())) {
        de_facto = true;
    }
    let status = if conflict {
        "conflict"
    } else if de_jure && de_facto {
        "confirmed"
    } else if de_jure {
        "de_jure_only"
    } else if de_facto {
        "de_facto_only"
    } else if espoused {
        "espoused_only"
    } else {
        "ungrounded"
    };
    StepConformance {
        step_id: step.step_id.clone(),
        text: step.text.clone(),
        de_jure,
        de_facto,
        espoused,
        conflict,
        status: status.to_string(),
    }
}

/// The conformance report (spec 10 §2/§6): per step, whether the de jure (SOP), de
/// facto (events), and espoused (interview) processes agree — distinguishing what is
/// documented-but-not-observed from observed-but-not-documented, and flagging
/// conflicts. Runs over all logic units, or one.
pub fn conformance(ont: &Ontology, only: Option<&str>) -> Vec<LogicUnitConformance> {
    let mut out: Vec<LogicUnitConformance> = ont
        .logic_units
        .values()
        .filter(|lu| only.is_none_or(|id| lu.logic_unit_id == id || lu.name == id))
        .map(|lu| {
            let steps: Vec<StepConformance> = lu.steps.iter().map(|s| step_conformance(ont, lu, s)).collect();
            let mut summary = ConformanceSummary::default();
            for s in &steps {
                match s.status.as_str() {
                    "confirmed" => summary.confirmed += 1,
                    "de_jure_only" => summary.de_jure_only += 1,
                    "de_facto_only" => summary.de_facto_only += 1,
                    "espoused_only" => summary.espoused_only += 1,
                    "conflict" => summary.conflict += 1,
                    _ => summary.ungrounded += 1,
                }
            }
            LogicUnitConformance {
                logic_unit_id: lu.logic_unit_id.clone(),
                name: lu.name.clone(),
                state: state_str(lu.state).to_string(),
                trust_class: trust_str(lu.trust_class).to_string(),
                steps,
                summary,
            }
        })
        .collect();
    out.sort_by(|a, b| a.logic_unit_id.cmp(&b.logic_unit_id));
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct DriftView {
    pub logic_unit_id: String,
    pub name: String,
    pub baseline_steps: Vec<String>,
    pub current_steps: Vec<String>,
    /// Jaccard distance between the promoted baseline and the current event stream
    /// (0 = unchanged, 1 = fully diverged). The producer's conformance loop demotes
    /// a flow whose drift crosses `conformance.drift_max` (spec 10 §6).
    pub drift: f64,
}

/// Per executable logic unit, the drift of the current event stream from the frozen
/// baseline recorded at promotion (spec 10 §6). Read-only measurement; the auto-demote
/// action lives in the producer's conformance loop.
pub fn drift(ont: &Ontology) -> Vec<DriftView> {
    use std::collections::BTreeSet;
    let mut out: Vec<DriftView> = Vec::new();
    for (id, lu) in &ont.logic_units {
        if !matches!(lu.state, LogicUnitState::Executable) {
            continue;
        }
        let Some(c) = &lu.contract else { continue };
        let baseline: BTreeSet<&str> = c.baseline_steps.iter().map(|s| s.as_str()).collect();
        let current: BTreeSet<String> = ont
            .events
            .values()
            .filter(|e| &e.logic_unit_id == id)
            .filter_map(|e| e.step_id.clone())
            .collect();
        let current_ref: BTreeSet<&str> = current.iter().map(|s| s.as_str()).collect();
        let inter = baseline.intersection(&current_ref).count();
        let union = baseline.union(&current_ref).count();
        let drift = if union == 0 { 0.0 } else { 1.0 - inter as f64 / union as f64 };
        out.push(DriftView {
            logic_unit_id: id.clone(),
            name: lu.name.clone(),
            baseline_steps: c.baseline_steps.clone(),
            current_steps: current.into_iter().collect(),
            drift,
        });
    }
    out.sort_by(|a, b| a.logic_unit_id.cmp(&b.logic_unit_id));
    out
}

/// List interfaces with the entity types that implement each (spec 01 §10).
pub fn interfaces(ont: &Ontology) -> Vec<InterfaceView> {
    let mut out: Vec<InterfaceView> = ont
        .interfaces
        .values()
        .map(|iface| {
            let mut implemented_by: Vec<String> = ont
                .entity_types
                .keys()
                .filter(|tid| interface_ids_of(ont, tid).contains(&iface.interface_id))
                .cloned()
                .collect();
            implemented_by.sort();
            InterfaceView {
                interface_id: iface.interface_id.clone(),
                name: iface.name.clone(),
                property_count: iface.property_schema.len(),
                implemented_by,
            }
        })
        .collect();
    out.sort_by(|a, b| a.interface_id.cmp(&b.interface_id));
    out
}

// ─── facts grounding an entity ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FactView {
    pub fact_id: String,
    pub kind: FactKind,
    pub text: String,
    pub confidence: f64,
    pub fidelity: Fidelity,
    pub receipts: Vec<ReceiptView>,
}

pub fn facts(ont: &Ontology, entity_id: &str) -> Result<Vec<FactView>> {
    let e = ont
        .entities
        .get(entity_id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("entity {entity_id:?}")))?;
    let mut ids: Vec<String> = e.provenance.fact_ids.clone();
    for m in e.resolved_from.clone().unwrap_or_default() {
        if let Some(me) = ont.entities.get(&m) {
            ids.extend(me.provenance.fact_ids.clone());
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids
        .iter()
        .filter_map(|fid| ont.facts.get(fid))
        .map(|f| FactView {
            fact_id: f.fact_id.clone(),
            kind: f.kind,
            text: f.text.clone(),
            confidence: f.confidence,
            fidelity: f.fidelity,
            receipts: receipts_for_facts(ont, std::slice::from_ref(&f.fact_id)),
        })
        .collect())
}

// ─── links ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LinkView {
    pub link_id: String,
    pub link_type_id: String,
    pub link_type_name: Option<String>,
    pub from: String,
    pub to: String,
    pub fidelity: Fidelity,
    pub neighbor: String,
    pub neighbor_label: Option<String>,
    pub receipts: Vec<ReceiptView>,
}

fn link_view(ont: &Ontology, l: &Link, relative_to: Option<&str>) -> LinkView {
    let neighbor = match relative_to {
        Some(id) if l.from == id => l.to.clone(),
        Some(_) => l.from.clone(),
        None => l.to.clone(),
    };
    LinkView {
        link_id: l.link_id.clone(),
        link_type_id: l.link_type_id.clone(),
        link_type_name: ont.link_types.get(&l.link_type_id).map(|t| t.name.clone()),
        from: l.from.clone(),
        to: l.to.clone(),
        fidelity: l.fidelity,
        neighbor: neighbor.clone(),
        neighbor_label: ont.entities.get(&neighbor).map(|e| e.label.clone()),
        receipts: receipts_for_facts(ont, &l.provenance.fact_ids),
    }
}

/// Links touching an entity (either endpoint), with receipts.
pub fn links(ont: &Ontology, entity_id: &str) -> Result<Vec<LinkView>> {
    if !ont.entities.contains_key(entity_id) {
        return Err(SmoothieError::FileNotFound(format!("entity {entity_id:?}")));
    }
    let mut out: Vec<LinkView> = ont
        .links
        .values()
        .filter(|l| l.from == entity_id || l.to == entity_id)
        .map(|l| link_view(ont, l, Some(entity_id)))
        .collect();
    out.sort_by(|a, b| a.link_id.cmp(&b.link_id));
    Ok(out)
}

// ─── traverse ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ReachedEntity {
    pub entity_id: String,
    pub label: String,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraversalView {
    pub from: String,
    pub max_depth: usize,
    pub reached: Vec<ReachedEntity>,
    pub path: Vec<LinkView>,
}

/// Bounded breadth-first traversal from an entity, following typed links in any
/// direction. Deterministic (neighbors visited in sorted order).
pub fn traverse(ont: &Ontology, from: &str, max_depth: usize) -> Result<TraversalView> {
    if !ont.entities.contains_key(from) {
        return Err(SmoothieError::FileNotFound(format!("entity {from:?}")));
    }
    let mut depth: BTreeMap<String, usize> = BTreeMap::new();
    depth.insert(from.to_string(), 0);
    let mut queue: VecDeque<String> = VecDeque::new();
    queue.push_back(from.to_string());
    let mut path: Vec<LinkView> = Vec::new();

    while let Some(cur) = queue.pop_front() {
        let d = depth[&cur];
        if d >= max_depth {
            continue;
        }
        let mut touching: Vec<&Link> = ont.links.values().filter(|l| l.from == cur || l.to == cur).collect();
        touching.sort_by(|a, b| a.link_id.cmp(&b.link_id));
        for l in touching {
            let neighbor = if l.from == cur { &l.to } else { &l.from };
            if !depth.contains_key(neighbor) {
                depth.insert(neighbor.clone(), d + 1);
                queue.push_back(neighbor.clone());
            }
            path.push(link_view(ont, l, Some(&cur)));
        }
    }

    let mut reached: Vec<ReachedEntity> = depth
        .iter()
        .filter_map(|(id, d)| ont.entities.get(id).map(|e| ReachedEntity { entity_id: id.clone(), label: e.label.clone(), depth: *d }))
        .collect();
    reached.sort_by(|a, b| (a.depth, a.entity_id.clone()).cmp(&(b.depth, b.entity_id.clone())));
    Ok(TraversalView { from: from.to_string(), max_depth, reached, path })
}

// ─── resolve (the resolution graph) ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ResolveView {
    pub entity_id: String,
    /// "canonical" (absorbed members), "member" (merged into a canonical), or
    /// "independent" (not part of any resolution).
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

pub fn resolve(ont: &Ontology, id: &str) -> Result<ResolveView> {
    let e = ont
        .entities
        .get(id)
        .ok_or_else(|| SmoothieError::FileNotFound(format!("entity {id:?}")))?;

    if let Some(canonical) = &e.merged_into {
        let r = ont.resolutions.values().find(|r| r.members.contains(&e.entity_id));
        return Ok(ResolveView {
            entity_id: e.entity_id.clone(),
            role: "member".to_string(),
            canonical: Some(canonical.clone()),
            members: Vec::new(),
            resolution_id: r.map(|r| r.resolution_id.clone()),
            confidence: r.map(|r| r.confidence),
            method: r.map(|r| format!("{:?}", r.method).to_lowercase()),
        });
    }
    if let Some(members) = &e.resolved_from {
        let r = ont.resolutions.values().find(|r| &r.canonical == &e.entity_id);
        return Ok(ResolveView {
            entity_id: e.entity_id.clone(),
            role: "canonical".to_string(),
            canonical: None,
            members: members.clone(),
            resolution_id: r.map(|r| r.resolution_id.clone()),
            confidence: r.map(|r| r.confidence),
            method: r.map(|r| format!("{:?}", r.method).to_lowercase()),
        });
    }
    Ok(ResolveView {
        entity_id: e.entity_id.clone(),
        role: "independent".to_string(),
        canonical: None,
        members: Vec::new(),
        resolution_id: None,
        confidence: None,
        method: None,
    })
}

// ─── gaps ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct GapView {
    pub kind: String,
    pub entity_id: Option<String>,
    pub text: String,
}

/// Surface gaps: orphan entities (could not be typed/placed) plus any `notes`.
pub fn gaps(ont: &Ontology) -> Vec<GapView> {
    let mut out: Vec<GapView> = ont
        .entities
        .values()
        .filter(|e| matches!(e.status, EntityStatus::Orphan))
        .map(|e| GapView { kind: "orphan_entity".to_string(), entity_id: Some(e.entity_id.clone()), text: format!("entity {:?} could not be typed/placed", e.label) })
        .collect();
    for n in &ont.notes {
        out.push(GapView { kind: "note".to_string(), entity_id: None, text: n.to_string() });
    }
    out
}
