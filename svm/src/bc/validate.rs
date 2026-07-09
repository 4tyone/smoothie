//! The provenance-guarantee gates, enforced in code (spec 02 · §"The provenance
//! guarantee (enforced at compile)" + invariants in spec 01).
//!
//! The TS frontend validates a BC on **write**; the SVM re-validates on **read** —
//! a shared BC is untrusted input (spec 06), so the consumer never takes the
//! producer's word for it. These are the four gates plus structural checks:
//!
//! 1. Receipted — every node/edge/view/fact carries non-empty `source_refs`,
//!    each resolving to a real `source_id`.
//! 2. Honest fidelity — `confirmed` requires a Resolver resolution receipt
//!    (`crawl`/`live`/`resolve`); confirmed nodes carry evaluated checks. No
//!    model-word-alone `confirmed`.
//! 3. Non-empty locators — (web-app profile) every `Locator.primary.value` is
//!    non-empty.
//! 4. No laundered trust — an outline/scene is no more trusted than the
//!    least-trusted node it depends on.
//!
//! A BC failing any gate is rejected — `compile` (write) and the SVM (read) both
//! fail loudly. There is no path by which the model's word alone becomes
//! `confirmed`. See the per-gate functions below for the exact rules.

use std::fmt;
use std::path::Path;

use crate::bc::types::*;

/// A single validation failure, with a stable machine code and a human message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    /// Stable code for tests/tooling, e.g. `"schema"`, `"receipt"`,
    /// `"fidelity"`, `"locator"`, `"laundered-trust"`, `"extensions"`.
    pub code: &'static str,
    /// Where in the BC the failure is, e.g. `"graph.nodes[checkout]"`.
    pub location: String,
    /// What's wrong, in plain language.
    pub message: String,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}: {}", self.code, self.location, self.message)
    }
}

/// The outcome of validating a BC: either valid, or a non-empty list of errors.
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

/// Parse a BC from JSON text. Serde structurally enforces required fields, enum
/// variants, and (top-level) `deny_unknown_fields` — this is the schema gate.
pub fn parse(json: &str) -> Result<Bc, ValidationError> {
    serde_json::from_str::<Bc>(json).map_err(|e| ValidationError {
        code: "schema",
        location: format!("line {}, column {}", e.line(), e.column()),
        message: e.to_string(),
    })
}

/// Validate a parsed BC against the provenance-guarantee gates.
///
/// `base_dir` is the directory the `bc.json` lives in; companion-file existence
/// is checked relative to it. Pass `None` to skip on-disk companion checks
/// (e.g. validating an in-memory BC).
pub fn validate(bc: &Bc, base_dir: Option<&Path>) -> ValidationReport {
    let mut report = ValidationReport::default();

    check_schema_version(bc, &mut report);
    check_extension_namespaces(bc, &mut report);
    check_receipts(bc, base_dir, &mut report);
    check_honest_fidelity(bc, &mut report);
    check_locators(bc, &mut report);
    check_no_laundered_trust(bc, &mut report);

    report
}

/// Convenience: read a `bc.json` from disk, parse, and validate against its dir.
pub fn validate_file(path: &Path) -> Result<ValidationReport, ValidationError> {
    let json = std::fs::read_to_string(path).map_err(|e| ValidationError {
        code: "io",
        location: path.display().to_string(),
        message: format!("cannot read BC file: {e}"),
    })?;
    let bc = parse(&json)?;
    let base_dir = path.parent();
    Ok(validate(&bc, base_dir))
}

// ─── Gate 0: schema version + extension namespaces ───────────────────────────

fn check_schema_version(bc: &Bc, report: &mut ValidationReport) {
    if bc.schema != SCHEMA_VERSION {
        report.push(
            "schema",
            "schema",
            format!(
                "unsupported schema version {:?}; this SVM understands {:?}",
                bc.schema, SCHEMA_VERSION
            ),
        );
    }
}

fn check_extension_namespaces(bc: &Bc, report: &mut ValidationReport) {
    // spec 02: "Extension keys must be namespaced (reverse-DNS)."
    for key in bc.extensions.0.keys() {
        if !key.contains('.') {
            report.push(
                "extensions",
                format!("extensions[{key}]"),
                "extension keys must be reverse-DNS namespaces, e.g. com.smoothie.reader.video",
            );
        }
    }
}

// ─── Gate 1: receipted ───────────────────────────────────────────────────────

fn check_receipts(bc: &Bc, base_dir: Option<&Path>, report: &mut ValidationReport) {
    // A SourceRef must point at a registered source, and (when companions are
    // present on disk) the referenced files must exist.
    let resolve_ref = |sr: &SourceRef, loc: &str, report: &mut ValidationReport| {
        if !bc.sources.contains_key(&sr.source_id) {
            report.push(
                "receipt",
                loc.to_string(),
                format!("source_ref points at unknown source_id {:?}", sr.source_id),
            );
        }
    };

    // Facts carry receipts too (spec 02: "source_refs — non-empty").
    for (id, fact) in &bc.facts {
        let loc = format!("facts[{id}]");
        if fact.source_refs.is_empty() {
            report.push("receipt", &loc, "fact has no source_refs (receipts must be non-empty)");
        }
        // `confidence` is a probability — the contract bounds it to [0, 1]
        // (bc.v1.schema.json). Enforce on read so a producer bug can't smuggle an
        // out-of-range value the schema would reject.
        if !(0.0..=1.0).contains(&fact.confidence) || fact.confidence.is_nan() {
            report.push("schema", &loc, &format!("confidence {} out of range [0, 1]", fact.confidence));
        }
        for sr in &fact.source_refs {
            resolve_ref(sr, &loc, report);
        }
    }

    // Every node and edge is receipted (provenance guarantee #1).
    for (id, node) in &bc.graph.nodes {
        let loc = format!("graph.nodes[{id}]");
        if node.source_refs.is_empty() {
            report.push("receipt", &loc, "node has no source_refs (receipts must be non-empty)");
        }
        for sr in &node.source_refs {
            resolve_ref(sr, &loc, report);
        }
    }
    for (i, edge) in bc.graph.edges.iter().enumerate() {
        let loc = format!("graph.edges[{i}] ({}->{})", edge.from, edge.to);
        if edge.source_refs.is_empty() {
            report.push("receipt", &loc, "edge has no source_refs (receipts must be non-empty, incl. linker-induced edges)");
        }
        for sr in &edge.source_refs {
            resolve_ref(sr, &loc, report);
        }
        // Edge endpoints must reference real nodes.
        if !bc.graph.nodes.contains_key(&edge.from) {
            report.push("receipt", &loc, format!("edge.from references unknown node {:?}", edge.from));
        }
        if !bc.graph.nodes.contains_key(&edge.to) {
            report.push("receipt", &loc, format!("edge.to references unknown node {:?}", edge.to));
        }
    }

    // Confirmed views are receipted (provenance guarantee #1 names confirmed views);
    // every view's observations carry a receipt.
    for (id, view) in &bc.views {
        let loc = format!("views[{id}]");
        if view.fidelity == Fidelity::Confirmed && view.observations.is_empty() {
            report.push("receipt", &loc, "confirmed view must carry at least one observation receipt");
        }
        for (j, obs) in view.observations.iter().enumerate() {
            resolve_ref(&obs.source_ref, &format!("{loc}.observations[{j}]"), report);
        }
    }

    // Companion files referenced by sources must exist on disk (when we know the
    // dir) AND stay inside the BC directory. A hostile BC must not point a receipt
    // outside its bundle — that both breaks self-containment and turns validation
    // into a filesystem-existence probe (`../../../../etc/passwd`).
    if let Some(dir) = base_dir {
        for (id, source) in &bc.sources {
            for (j, comp) in source.companions.iter().enumerate() {
                let loc = format!("sources[{id}].companions[{j}]");
                if !is_contained(&comp.path) {
                    report.push("receipt", &loc, format!("companion path escapes the BC directory: {}", comp.path));
                    continue;
                }
                if !dir.join(&comp.path).exists() {
                    report.push("receipt", &loc, format!("companion file does not exist on disk: {}", comp.path));
                }
            }
        }
    }
}

/// A companion path must be relative and never traverse upward — it is resolved
/// against the (trusted) BC directory, so `..`/absolute paths are rejected before
/// they ever touch the filesystem.
fn is_contained(rel: &str) -> bool {
    let p = Path::new(rel);
    !p.is_absolute()
        && !p.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_)))
}

// ─── Gate 2: honest fidelity ─────────────────────────────────────────────────

fn check_honest_fidelity(bc: &Bc, report: &mut ValidationReport) {
    let has_resolution_receipt =
        |refs: &[SourceRef]| refs.iter().any(|sr| sr.span.is_resolution_receipt());

    for (id, node) in &bc.graph.nodes {
        if node.fidelity.requires_resolution_receipt() {
            let loc = format!("graph.nodes[{id}]");
            if !has_resolution_receipt(&node.source_refs) {
                report.push(
                    "fidelity",
                    &loc,
                    "confirmed node lacks a Resolver resolution receipt (crawl/live/resolve span)",
                );
            }
            // "...plus evaluated checks" — a confirmed node must carry checks.
            if node.checks.is_empty() {
                report.push(
                    "fidelity",
                    &loc,
                    "confirmed node must carry evaluated checks",
                );
            }
        }
    }

    for (i, edge) in bc.graph.edges.iter().enumerate() {
        if edge.fidelity.requires_resolution_receipt()
            && !has_resolution_receipt(&edge.source_refs)
        {
            report.push(
                "fidelity",
                format!("graph.edges[{i}] ({}->{})", edge.from, edge.to),
                "confirmed edge lacks a Resolver resolution receipt (a transition must be observed live)",
            );
        }
    }

    for (id, view) in &bc.views {
        if view.fidelity.requires_resolution_receipt() {
            let has = view
                .observations
                .iter()
                .any(|o| o.source_ref.span.is_resolution_receipt());
            if !has {
                report.push(
                    "fidelity",
                    format!("views[{id}]"),
                    "confirmed view lacks an observation with a resolution receipt",
                );
            }
        }
    }
}

// ─── Gate 3: non-empty locators (web-app profile) ────────────────────────────

fn check_locators(bc: &Bc, report: &mut ValidationReport) {
    if bc.manifest.profile != PROFILE_WEB_APP {
        return; // other profiles enforce their own "payload points at something real"
    }

    let check_locator = |loc: &Locator, where_: &str, report: &mut ValidationReport| {
        if loc.primary.value.trim().is_empty() {
            report.push("locator", where_.to_string(), "Locator.primary.value is empty");
        }
        for (k, fb) in loc.fallbacks.iter().enumerate() {
            if fb.value.trim().is_empty() {
                report.push(
                    "locator",
                    format!("{where_}.fallbacks[{k}]"),
                    "Locator fallback value is empty",
                );
            }
        }
    };

    for (id, node) in &bc.graph.nodes {
        let base = format!("graph.nodes[{id}]");
        if let Some(action) = &node.action {
            for loc in action_locators(action) {
                check_locator(loc, &format!("{base}.action"), report);
            }
        }
        for (c, check) in node.checks.iter().enumerate() {
            if let Some(loc) = check_locator_ref(check) {
                check_locator(loc, &format!("{base}.checks[{c}]"), report);
            }
        }
    }
}

fn action_locators(action: &Action) -> Vec<&Locator> {
    match action {
        Action::Click { locator }
        | Action::Fill { locator, .. }
        | Action::Select { locator, .. } => vec![locator],
        Action::Scroll { locator, .. } | Action::WaitFor { locator, .. } => {
            locator.iter().collect()
        }
        Action::Goto { .. } | Action::Press { .. } => vec![],
    }
}

fn check_locator_ref(check: &Check) -> Option<&Locator> {
    match check {
        Check::Visible { locator } | Check::Exists { locator } => Some(locator),
        Check::TextMatches { locator, .. } => locator.as_ref(),
        Check::UrlMatches { .. } => None,
    }
}

// ─── Gate 4: outlines don't launder trust ────────────────────────────────────

fn check_no_laundered_trust(bc: &Bc, report: &mut ValidationReport) {
    for (id, outline) in &bc.outlines {
        let mut outline_floor = Fidelity::Confirmed.rank(); // start at the top; lower it
        let mut outline_has_dep = false;

        for scene in &outline.scenes {
            // A scene is no more trusted than the least-trusted node it depends on.
            let mut scene_floor = Fidelity::Confirmed.rank();
            let mut scene_has_dep = false;
            for node_id in &scene.node_ids {
                if let Some(node) = bc.graph.nodes.get(node_id) {
                    scene_floor = scene_floor.min(node.fidelity.rank());
                    scene_has_dep = true;
                } else {
                    report.push(
                        "laundered-trust",
                        format!("outlines[{id}].scenes[{}]", scene.scene_id),
                        format!("scene references unknown node {node_id:?}"),
                    );
                }
            }
            if scene_has_dep && scene.fidelity.rank() > scene_floor {
                report.push(
                    "laundered-trust",
                    format!("outlines[{id}].scenes[{}]", scene.scene_id),
                    "scene fidelity exceeds the least-trusted node it depends on",
                );
            }
            // The outline floor is bounded by each scene's own (stated) fidelity.
            outline_floor = outline_floor.min(scene.fidelity.rank());
            outline_has_dep = true;
        }

        if outline_has_dep && outline.fidelity.rank() > outline_floor {
            report.push(
                "laundered-trust",
                format!("outlines[{id}]"),
                "outline fidelity exceeds the least-trusted scene it depends on",
            );
        }
    }
}
