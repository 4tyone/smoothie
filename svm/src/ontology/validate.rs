//! The `ontology.v1` validation gates G1-G7 (spec 01 §8), enforced in code,
//! fail-closed. The TS frontend validates on write; the SVM re-validates on read
//! (a shared ontology is untrusted input, spec 06), so the consumer never takes the
//! producer's word for it. Each gate names the offending id.
//!
//!   G1 grounding  · every entity/value/link/type carries evidencing facts, and
//!                   every fact carries a resolvable receipt.
//!   G2 type       · every entity conforms to its type's property schema.
//!   G3 ref        · every type_id/link_type_id/endpoint/ref/fact_id resolves;
//!                   link endpoints match the link type's declared endpoints.
//!   G4 identity   · every collection's map key equals the object's own id.
//!   G5 resolution · every resolution is reversible, evidence-backed, conflict-free.
//!   G6 security   · every referenced security_id is defined in policy.security.
//!   G7 envelope   · version pins a hash for every source (reproducibility).

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

use crate::ontology::types::*;

/// A single validation failure, with a stable machine code and a human message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    /// Stable code for tests/tooling: `"schema"`, `"grounding"`, `"type"`, `"ref"`,
    /// `"identity"`, `"resolution"`, `"security"`, `"envelope"`, `"extensions"`.
    pub code: &'static str,
    /// Where in the ontology the failure is, e.g. `"entities[e_seg_ci]"`.
    pub location: String,
    pub message: String,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}: {}", self.code, self.location, self.message)
    }
}

#[derive(Debug, Clone, Default)]
pub struct ValidationReport {
    pub errors: Vec<ValidationError>,
}

impl ValidationReport {
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
    fn push(&mut self, code: &'static str, location: impl Into<String>, message: impl Into<String>) {
        self.errors.push(ValidationError {
            code,
            location: location.into(),
            message: message.into(),
        });
    }
}

/// Parse an ontology from JSON. Serde structurally enforces required fields, enum
/// variants, and top-level `deny_unknown_fields` — this is the schema gate.
pub fn parse(json: &str) -> Result<Ontology, ValidationError> {
    serde_json::from_str::<Ontology>(json).map_err(|e| ValidationError {
        code: "schema",
        location: format!("line {}, column {}", e.line(), e.column()),
        message: e.to_string(),
    })
}

/// Validate a parsed ontology against gates G1-G7. `base_dir` is accepted for parity
/// with the loader; on-disk companion checks are shared from `ingest`/`describe` and
/// are not repeated here (spec 09 §2).
pub fn validate(ont: &Ontology, _base_dir: Option<&Path>) -> ValidationReport {
    let mut report = ValidationReport::default();
    check_schema_version(ont, &mut report);
    check_extension_namespaces(ont, &mut report);
    check_g1_grounding(ont, &mut report);
    check_g2_type_conformance(ont, &mut report);
    check_g3_referential_integrity(ont, &mut report);
    check_g4_identity_stability(ont, &mut report);
    check_g5_resolution_integrity(ont, &mut report);
    check_g6_security(ont, &mut report);
    check_g7_envelope(ont, &mut report);
    check_g8_eligibility(ont, &mut report);
    check_g9_autonomy(ont, &mut report);
    report
}

/// Read an `ontology.json` from disk, parse, and validate against its directory.
pub fn validate_file(path: &Path) -> Result<ValidationReport, ValidationError> {
    let json = std::fs::read_to_string(path).map_err(|e| ValidationError {
        code: "io",
        location: path.display().to_string(),
        message: format!("cannot read ontology file: {e}"),
    })?;
    let ont = parse(&json)?;
    Ok(validate(&ont, path.parent()))
}

// ─── Gate 0: schema version + extension namespaces ───────────────────────────

fn check_schema_version(ont: &Ontology, report: &mut ValidationReport) {
    if ont.schema != SCHEMA_VERSION {
        report.push(
            "schema",
            "schema",
            format!(
                "unsupported schema version {:?}; this SVM understands {:?}",
                ont.schema, SCHEMA_VERSION
            ),
        );
    }
}

fn check_extension_namespaces(ont: &Ontology, report: &mut ValidationReport) {
    for key in ont.extensions.0.keys() {
        if !key.contains('.') {
            report.push(
                "extensions",
                format!("extensions[{key}]"),
                "extension keys must be reverse-DNS namespaces, e.g. com.smoothie.ontology",
            );
        }
    }
}

// ─── G1: grounding (spec 01 §8 G1) ───────────────────────────────────────────

fn check_g1_grounding(ont: &Ontology, report: &mut ValidationReport) {
    for (id, fact) in &ont.facts {
        let loc = format!("facts[{id}]");
        if fact.source_refs.is_empty() {
            report.push("grounding", &loc, "fact has no source_refs (a receipt is required)");
        }
        if !(0.0..=1.0).contains(&fact.confidence) || fact.confidence.is_nan() {
            report.push("schema", &loc, format!("confidence {} out of range [0, 1]", fact.confidence));
        }
        for sr in &fact.source_refs {
            if !ont.sources.contains_key(&sr.source_id) {
                report.push("grounding", &loc, format!("source_ref points at unknown source_id {:?}", sr.source_id));
            }
        }
    }

    for (id, et) in &ont.entity_types {
        if et.provenance.fact_ids.is_empty() {
            report.push("grounding", format!("entity_types[{id}]"), "entity type has no justifying fact (provenance.fact_ids empty)");
        }
    }
    for (id, lt) in &ont.link_types {
        if lt.provenance.fact_ids.is_empty() {
            report.push("grounding", format!("link_types[{id}]"), "link type has no justifying fact (provenance.fact_ids empty)");
        }
    }

    for (id, e) in &ont.entities {
        let loc = format!("entities[{id}]");
        if e.provenance.fact_ids.is_empty() {
            report.push("grounding", &loc, "entity has no evidencing fact (provenance.fact_ids empty)");
        }
        for (pname, vals) in &e.properties {
            for (i, v) in vals.iter().enumerate() {
                if v.fact_ids.is_empty() {
                    report.push("grounding", format!("{loc}.properties.{pname}[{i}]"), "property value cites no fact");
                }
            }
        }
    }

    for (id, l) in &ont.links {
        if l.provenance.fact_ids.is_empty() {
            report.push("grounding", format!("links[{id}]"), "link cites no fact");
        }
    }

    // Verb layer (spec 10 §1): every event carries a receipt (a log line / transaction).
    for (id, ev) in &ont.events {
        if ev.source_refs.is_empty() {
            report.push("grounding", format!("events[{id}]"), "event has no source_refs (a receipt is required)");
        }
        for sr in &ev.source_refs {
            if !ont.sources.contains_key(&sr.source_id) {
                report.push("grounding", format!("events[{id}]"), format!("source_ref points at unknown source_id {:?}", sr.source_id));
            }
        }
    }
}

// ─── G2: type conformance (spec 01 §8 G2) ────────────────────────────────────

fn check_g2_type_conformance(ont: &Ontology, report: &mut ValidationReport) {
    for (eid, e) in &ont.entities {
        // A missing type is a G3 concern; skip conformance if we cannot resolve it.
        let et = match ont.entity_types.get(&e.type_id) {
            Some(t) => t,
            None => continue,
        };
        let loc = format!("entities[{eid}]");

        for (pname, ps) in &et.property_schema {
            // Derived properties are computed by the consumer, not stored (§10).
            if ps.required && ps.derived.is_none() && !e.properties.contains_key(pname) {
                report.push("type", &loc, format!("missing required property {pname:?}"));
            }
        }

        // Interface conformance (§10): satisfy every interface the type implements.
        for iface in collect_interfaces(ont, &e.type_id) {
            for (pname, ps) in &iface.property_schema {
                if ps.required && ps.derived.is_none() && !e.properties.contains_key(pname) {
                    report.push("type", &loc, format!("does not satisfy interface {:?}: missing required property {pname:?}", iface.name));
                }
            }
        }

        for (pname, vals) in &e.properties {
            let ps = match et.property_schema.get(pname) {
                Some(p) => p,
                None => {
                    report.push("type", &loc, format!("unknown property {pname:?} not in type {:?} schema", et.type_id));
                    continue;
                }
            };
            if ps.derived.is_some() {
                continue; // derived values are computed, not validated as stored data
            }
            if matches!(ps.cardinality, Cardinality::One) && vals.len() > 1 {
                report.push("type", &loc, format!("property {pname:?} is cardinality one but has {} values", vals.len()));
            }
            for (i, v) in vals.iter().enumerate() {
                let vloc = format!("{loc}.properties.{pname}[{i}]");
                match ps.value_kind {
                    ValueKind::String | ValueKind::Date => {
                        if !v.value.is_string() {
                            report.push("type", &vloc, "expected a string value");
                        }
                    }
                    ValueKind::Number => {
                        if !v.value.is_number() {
                            report.push("type", &vloc, "expected a number value");
                        }
                    }
                    ValueKind::Boolean => {
                        if !v.value.is_boolean() {
                            report.push("type", &vloc, "expected a boolean value");
                        }
                    }
                    ValueKind::Geopoint => {
                        if !v.value.is_object() {
                            report.push("type", &vloc, "expected a geopoint object");
                        }
                    }
                    ValueKind::Struct => match v.value.as_object() {
                        Some(obj) => {
                            if let Some(fields) = &ps.struct_fields {
                                for (fname, fs) in fields {
                                    match obj.get(fname) {
                                        None => {
                                            if fs.required {
                                                report.push("type", &vloc, format!("struct missing required field {fname:?}"));
                                            }
                                        }
                                        Some(fv) => {
                                            if !value_matches_kind(fv, fs.value_kind) {
                                                report.push("type", &vloc, format!("struct field {fname:?} has the wrong kind"));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        None => report.push("type", &vloc, "expected a struct object value"),
                    },
                    ValueKind::Enum => match v.value.as_str() {
                        Some(s) => {
                            if let Some(ev) = &ps.enum_values {
                                if !ev.iter().any(|x| x == s) {
                                    report.push("type", &vloc, format!("enum value {s:?} not in declared range"));
                                }
                            }
                        }
                        None => report.push("type", &vloc, "enum value must be a string"),
                    },
                    ValueKind::Ref => match v.value.as_str() {
                        Some(s) => {
                            // Existence is G3; here we check the target's TYPE matches ref_type_id.
                            if let (Some(target), Some(rt)) = (ont.entities.get(s), &ps.ref_type_id) {
                                if &target.type_id != rt {
                                    report.push("type", &vloc, format!("ref points at an entity of type {:?}, expected {:?}", target.type_id, rt));
                                }
                            }
                        }
                        None => report.push("type", &vloc, "ref value must be an entity_id string"),
                    },
                }
            }
        }
    }
}

// ─── G3: referential integrity (spec 01 §8 G3) ───────────────────────────────

fn check_g3_referential_integrity(ont: &Ontology, report: &mut ValidationReport) {
    let fact_exists = |fid: &str| ont.facts.contains_key(fid);

    for (eid, e) in &ont.entities {
        let loc = format!("entities[{eid}]");
        if !ont.entity_types.contains_key(&e.type_id) {
            report.push("ref", &loc, format!("type_id {:?} does not resolve to an entity type", e.type_id));
        }
        for fid in &e.provenance.fact_ids {
            if !fact_exists(fid) {
                report.push("ref", &loc, format!("provenance references unknown fact {fid:?}"));
            }
        }
        for sid in &e.provenance.source_ids {
            if !ont.sources.contains_key(sid) {
                report.push("ref", &loc, format!("provenance references unknown source {sid:?}"));
            }
        }
        for a in &e.aliases {
            if !ont.sources.contains_key(&a.source_id) {
                report.push("ref", &loc, format!("alias cites unknown source {:?}", a.source_id));
            }
        }
        for (pname, vals) in &e.properties {
            for (i, v) in vals.iter().enumerate() {
                let vloc = format!("{loc}.properties.{pname}[{i}]");
                for fid in &v.fact_ids {
                    if !fact_exists(fid) {
                        report.push("ref", &vloc, format!("value references unknown fact {fid:?}"));
                    }
                }
                if let Some(et) = ont.entity_types.get(&e.type_id) {
                    if let Some(ps) = et.property_schema.get(pname) {
                        if matches!(ps.value_kind, ValueKind::Ref) {
                            if let Some(s) = v.value.as_str() {
                                if !ont.entities.contains_key(s) {
                                    report.push("ref", &vloc, format!("ref target {s:?} does not resolve to an entity"));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for (id, et) in &ont.entity_types {
        for fid in &et.provenance.fact_ids {
            if !fact_exists(fid) {
                report.push("ref", format!("entity_types[{id}]"), format!("provenance references unknown fact {fid:?}"));
            }
        }
    }
    for (id, lt) in &ont.link_types {
        for fid in &lt.provenance.fact_ids {
            if !fact_exists(fid) {
                report.push("ref", format!("link_types[{id}]"), format!("provenance references unknown fact {fid:?}"));
            }
        }
    }

    // §10 interfaces: every `extends` must resolve to a defined interface.
    for (id, et) in &ont.entity_types {
        for iid in et.extends.iter().flatten() {
            if !ont.interfaces.contains_key(iid) {
                report.push("ref", format!("entity_types[{id}]"), format!("extends unknown interface {iid:?}"));
            }
        }
    }
    for (id, iface) in &ont.interfaces {
        for iid in iface.extends.iter().flatten() {
            if !ont.interfaces.contains_key(iid) {
                report.push("ref", format!("interfaces[{id}]"), format!("extends unknown interface {iid:?}"));
            }
        }
    }

    for (id, l) in &ont.links {
        let loc = format!("links[{id}]");
        let lt = ont.link_types.get(&l.link_type_id);
        if lt.is_none() {
            report.push("ref", &loc, format!("link_type_id {:?} does not resolve", l.link_type_id));
        }
        let from = ont.entities.get(&l.from);
        let to = ont.entities.get(&l.to);
        if from.is_none() {
            report.push("ref", &loc, format!("link.from {:?} does not resolve to an entity", l.from));
        }
        if to.is_none() {
            report.push("ref", &loc, format!("link.to {:?} does not resolve to an entity", l.to));
        }
        if let (Some(lt), Some(from)) = (lt, from) {
            if lt.from_type_id != "*" && from.type_id != lt.from_type_id {
                report.push("ref", &loc, format!("link.from is type {:?} but link type expects {:?}", from.type_id, lt.from_type_id));
            }
        }
        if let (Some(lt), Some(to)) = (lt, to) {
            if lt.to_type_id != "*" && to.type_id != lt.to_type_id {
                report.push("ref", &loc, format!("link.to is type {:?} but link type expects {:?}", to.type_id, lt.to_type_id));
            }
        }
        for fid in &l.provenance.fact_ids {
            if !fact_exists(fid) {
                report.push("ref", &loc, format!("provenance references unknown fact {fid:?}"));
            }
        }
    }

    for (id, r) in &ont.resolutions {
        for fid in &r.evidence.fact_ids {
            if !fact_exists(fid) {
                report.push("ref", format!("resolutions[{id}]"), format!("evidence references unknown fact {fid:?}"));
            }
        }
    }

    // Verb layer: event.logic_unit_id and step evidence refs must resolve.
    for (id, ev) in &ont.events {
        if !ont.logic_units.contains_key(&ev.logic_unit_id) {
            report.push("ref", format!("events[{id}]"), format!("logic_unit_id {:?} does not resolve", ev.logic_unit_id));
        }
    }
    for (id, lu) in &ont.logic_units {
        for (si, step) in lu.steps.iter().enumerate() {
            for (ei, ev) in step.evidence.iter().enumerate() {
                let loc = format!("logic_units[{id}].steps[{si}].evidence[{ei}]");
                if let Some(sid) = &ev.source_id {
                    if !ont.sources.contains_key(sid) {
                        report.push("ref", &loc, format!("evidence source_id {sid:?} does not resolve"));
                    }
                }
                for evid in &ev.event_ids {
                    if !ont.events.contains_key(evid) {
                        report.push("ref", &loc, format!("evidence event_id {evid:?} does not resolve"));
                    }
                }
            }
        }
    }
}

// ─── G4: identity stability (spec 01 §8 G4, spec 05 §2) ──────────────────────

fn check_g4_identity_stability(ont: &Ontology, report: &mut ValidationReport) {
    // The single-file checkable part: a collection's map key must equal the object's
    // own id. Cross-version reassignment is checked by the store (spec 05, Phase 4).
    for (k, s) in &ont.sources {
        if k != &s.source_id {
            report.push("identity", format!("sources[{k}]"), format!("map key {k:?} != source_id {:?}", s.source_id));
        }
    }
    for (k, f) in &ont.facts {
        if k != &f.fact_id {
            report.push("identity", format!("facts[{k}]"), format!("map key {k:?} != fact_id {:?}", f.fact_id));
        }
    }
    for (k, t) in &ont.entity_types {
        if k != &t.type_id {
            report.push("identity", format!("entity_types[{k}]"), format!("map key {k:?} != type_id {:?}", t.type_id));
        }
    }
    for (k, e) in &ont.entities {
        if k != &e.entity_id {
            report.push("identity", format!("entities[{k}]"), format!("map key {k:?} != entity_id {:?}", e.entity_id));
        }
    }
    for (k, t) in &ont.link_types {
        if k != &t.link_type_id {
            report.push("identity", format!("link_types[{k}]"), format!("map key {k:?} != link_type_id {:?}", t.link_type_id));
        }
    }
    for (k, l) in &ont.links {
        if k != &l.link_id {
            report.push("identity", format!("links[{k}]"), format!("map key {k:?} != link_id {:?}", l.link_id));
        }
    }
    for (k, r) in &ont.resolutions {
        if k != &r.resolution_id {
            report.push("identity", format!("resolutions[{k}]"), format!("map key {k:?} != resolution_id {:?}", r.resolution_id));
        }
    }
    for (k, i) in &ont.interfaces {
        if k != &i.interface_id {
            report.push("identity", format!("interfaces[{k}]"), format!("map key {k:?} != interface_id {:?}", i.interface_id));
        }
    }
    for (k, lu) in &ont.logic_units {
        if k != &lu.logic_unit_id {
            report.push("identity", format!("logic_units[{k}]"), format!("map key {k:?} != logic_unit_id {:?}", lu.logic_unit_id));
        }
    }
    for (k, ev) in &ont.events {
        if k != &ev.event_id {
            report.push("identity", format!("events[{k}]"), format!("map key {k:?} != event_id {:?}", ev.event_id));
        }
    }
}

// ─── G8: promotion eligibility (spec 10 §2) ──────────────────────────────────

/// An `executable` logic unit must satisfy the eligibility invariant: every step is
/// attested by de facto evidence (never fiction-only) and conflict-free. This is the
/// standing invariant that a promotion must have passed; the producer's `promote`
/// command enforces the configured support threshold before ever reaching here.
fn check_g8_eligibility(ont: &Ontology, report: &mut ValidationReport) {
    for (id, lu) in &ont.logic_units {
        if !matches!(lu.state, LogicUnitState::Executable) {
            continue;
        }
        for step in &lu.steps {
            let mut de_facto = false;
            let mut conflict = false;
            for ev in &step.evidence {
                if matches!(ev.class, EvidenceClass::DeFacto) {
                    de_facto = true;
                }
                if ev.contradicts {
                    conflict = true;
                }
            }
            if ont.events.values().any(|e| e.logic_unit_id == lu.logic_unit_id && e.step_id.as_deref() == Some(step.step_id.as_str())) {
                de_facto = true;
            }
            let loc = format!("logic_units[{id}].steps[{}]", step.step_id);
            if conflict {
                report.push("eligibility", &loc, "executable logic unit has an unresolved conflict step (G8)");
            }
            if !de_facto {
                report.push("eligibility", &loc, "executable logic unit has a fiction-only step: no de facto attestation (G8)");
            }
        }
    }
}

// ─── G9: autonomy floor + bounded kinetic surface (spec 10 §4-§5) ────────────

/// Blast-radius small/large boundary and the judged-unit oversight penalty. These
/// mirror the producer's config defaults (spec 10 §8); the gate enforces the floor.
const BLAST_SMALL_MAX: u64 = 50;
const JUDGED_PENALTY: u8 = 1;

fn parse_level(s: &str) -> Option<u8> {
    match s {
        "L0" => Some(0),
        "L1" => Some(1),
        "L2" => Some(2),
        "L3" => Some(3),
        _ => None,
    }
}

/// The effective disposition may not exceed the floor derived from reversibility ×
/// blast radius (spec 10 §5): reversible+small=L3, reversible+large=L2,
/// irreversible+small=L1, irreversible+large=L0; a judged unit takes a one-level
/// oversight penalty; unknown reversibility is treated as irreversible. Outputs may
/// only write within the declared kinetic surface (fail-closed).
fn check_g9_autonomy(ont: &Ontology, report: &mut ValidationReport) {
    for (id, lu) in &ont.logic_units {
        if !matches!(lu.state, LogicUnitState::Executable) {
            continue;
        }
        let Some(c) = &lu.contract else { continue };
        let loc = format!("logic_units[{id}].contract");

        let reversible = c.reversibility.as_deref() == Some("reversible");
        let blast_large = c.blast_radius.as_ref().map(|b| b.entities > BLAST_SMALL_MAX).unwrap_or(false);
        let base: u8 = match (reversible, blast_large) {
            (true, false) => 3,
            (true, true) => 2,
            (false, false) => 1, // irreversible / unknown, small
            (false, true) => 0,  // irreversible / unknown, large
        };
        let penalty = if matches!(lu.trust_class, TrustClass::Judged) { JUDGED_PENALTY } else { 0 };
        let floor = base.saturating_sub(penalty);

        if let Some(disp) = &c.disposition {
            match parse_level(&disp.effective) {
                Some(eff) => {
                    if eff > floor {
                        report.push("autonomy", &loc, format!("effective disposition {} exceeds the derived autonomy floor L{floor} (reversible={reversible}, blast_large={blast_large}, {:?})", disp.effective, lu.trust_class));
                    }
                }
                None => report.push("autonomy", &loc, format!("invalid disposition level {:?}", disp.effective)),
            }
        }

        let allowed: std::collections::BTreeSet<&str> = c
            .restrictions
            .as_ref()
            .map(|r| r.writes.iter().map(|s| s.as_str()).collect())
            .unwrap_or_default();
        for o in &c.outputs {
            if let Some(w) = &o.writes {
                if !allowed.contains(w.as_str()) {
                    report.push("autonomy", &loc, format!("output {:?} writes {:?} outside the declared kinetic surface", o.name, w));
                }
            }
        }
    }
}

// ─── §10 enrichment helpers ──────────────────────────────────────────────────

/// Whether a JSON value matches a scalar/struct value kind.
fn value_matches_kind(v: &serde_json::Value, k: ValueKind) -> bool {
    match k {
        ValueKind::String | ValueKind::Date | ValueKind::Enum | ValueKind::Ref => v.is_string(),
        ValueKind::Number => v.is_number(),
        ValueKind::Boolean => v.is_boolean(),
        ValueKind::Geopoint | ValueKind::Struct => v.is_object(),
    }
}

/// All interfaces a type implements, transitively through interface `extends`.
fn collect_interfaces<'a>(ont: &'a Ontology, type_id: &str) -> Vec<&'a Interface> {
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut stack: Vec<String> = ont
        .entity_types
        .get(type_id)
        .and_then(|t| t.extends.clone())
        .unwrap_or_default();
    while let Some(iid) = stack.pop() {
        if !seen.insert(iid.clone()) {
            continue;
        }
        if let Some(iface) = ont.interfaces.get(&iid) {
            out.push(iface);
            if let Some(ext) = &iface.extends {
                stack.extend(ext.clone());
            }
        }
    }
    out
}

// ─── G5: resolution integrity (spec 01 §8 G5, §7) ────────────────────────────

fn check_g5_resolution_integrity(ont: &Ontology, report: &mut ValidationReport) {
    // A member may not belong to two live resolutions with different canonicals.
    let mut seen: BTreeMap<&str, &str> = BTreeMap::new();

    for (id, r) in &ont.resolutions {
        let loc = format!("resolutions[{id}]");
        if !ont.entities.contains_key(&r.canonical) {
            report.push("resolution", &loc, format!("canonical {:?} does not resolve to an entity", r.canonical));
        }
        if r.evidence.fact_ids.is_empty() {
            report.push("resolution", &loc, "resolution is not evidence-backed (evidence.fact_ids empty)");
        }
        if !r.reversible {
            report.push("resolution", &loc, "resolution must be reversible (members retained)");
        }
        for m in &r.members {
            if !ont.entities.contains_key(m) {
                report.push("resolution", &loc, format!("member {m:?} does not resolve to an entity"));
            }
            if let Some(prev) = seen.get(m.as_str()) {
                if *prev != r.canonical.as_str() {
                    report.push("resolution", &loc, format!("member {m:?} belongs to two resolutions with different canonicals"));
                }
            }
            seen.insert(m.as_str(), r.canonical.as_str());
        }
        // The canonical must retain its members (spec 01 §7 materialization).
        if let Some(c) = ont.entities.get(&r.canonical) {
            if let Some(rf) = &c.resolved_from {
                for m in &r.members {
                    if !rf.contains(m) {
                        report.push("resolution", &loc, format!("canonical entity's resolved_from is missing member {m:?}"));
                    }
                }
            }
        }
    }
}

// ─── G6: security (spec 01 §8 G6, §10) ───────────────────────────────────────

fn check_g6_security(ont: &Ontology, report: &mut ValidationReport) {
    let defined = |sid: &str| ont.policy.security.contains_key(sid);

    for (id, e) in &ont.entities {
        if let Some(sid) = &e.security_id {
            if !defined(sid) {
                report.push("security", format!("entities[{id}]"), format!("security_id {sid:?} is not defined in policy.security"));
            }
        }
        for (pname, vals) in &e.properties {
            for (i, v) in vals.iter().enumerate() {
                if let Some(sid) = &v.security_id {
                    if !defined(sid) {
                        report.push("security", format!("entities[{id}].properties.{pname}[{i}]"), format!("security_id {sid:?} is not defined in policy.security"));
                    }
                }
            }
        }
    }
    for (id, l) in &ont.links {
        if let Some(sid) = &l.security_id {
            if !defined(sid) {
                report.push("security", format!("links[{id}]"), format!("security_id {sid:?} is not defined in policy.security"));
            }
        }
    }
}

// ─── G7: determinism envelope (spec 01 §8 G7, spec 05 §5) ────────────────────

fn check_g7_envelope(ont: &Ontology, report: &mut ValidationReport) {
    if ont.version.version_id.trim().is_empty() {
        report.push("envelope", "version", "version.version_id is empty");
    }
    for sid in ont.sources.keys() {
        if !ont.version.envelope.source_hashes.contains_key(sid) {
            report.push(
                "envelope",
                "version.envelope",
                format!("source_hashes is missing a pinned hash for source {sid:?} (reproducibility)"),
            );
        }
    }
}
