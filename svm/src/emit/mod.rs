//! Emit — the SVM's one built-in producer (spec 05 · Emit; 06 · §3).
//!
//! For the **web-app profile only**, the SVM emits a runnable slice with the
//! safety floor applied and guardrails baked in. This is a built-in (not an agent
//! plugin) for exactly one reason: **safety must be code, not a prompt** (spec 06).
//!
//! Properties (spec 05 · determinism posture):
//!   - a **pure function of the BC** + request — same input → same artifact;
//!   - runs **no model**, drives **no browser**, and has no side effect beyond
//!     writing the artifact;
//!   - the policy **floor** is enforced here and its guardrails baked into the
//!     output, so they travel with the artifact wherever it runs.
//!
//! `skill` and `test` are *examples* of an emit, not a closed registry.

mod skill;
mod test;

use serde::Serialize;

use crate::bc::types::*;
use crate::credentials::{CredentialRef, Redactor, Vault};
use crate::error::{Result, SmoothieError};
use crate::policy::audit::{AuditEntry, AuditLog};
use crate::policy::{action_text, classify, Decision, EffectivePolicy};

/// What to emit. Open-ended in spirit; `skill`/`test` are the v1 built-ins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Skill,
    Test,
}

impl Target {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "skill" => Ok(Target::Skill),
            "test" => Ok(Target::Test),
            other => Err(SmoothieError::InvalidArgument(format!(
                "emit target must be skill|test, got {other:?}"
            ))),
        }
    }
}

/// Which part of the BC to compile into a slice.
#[derive(Debug, Clone)]
pub enum SliceSpec {
    Outline(String),
    Nodes(Vec<String>),
}

/// Parse an execution mode (spec 06 · Modes). Default is `dry-run`.
pub fn parse_mode(s: &str) -> Result<Mode> {
    match s {
        "read-only" => Ok(Mode::ReadOnly),
        "dry-run" => Ok(Mode::DryRun),
        "live" => Ok(Mode::Live),
        other => Err(SmoothieError::InvalidArgument(format!(
            "mode must be read-only|dry-run|live, got {other:?}"
        ))),
    }
}

fn mode_str(m: Mode) -> &'static str {
    match m {
        Mode::ReadOnly => "read-only",
        Mode::DryRun => "dry-run",
        Mode::Live => "live",
    }
}

/// One step of the resolved slice: a node, its classification, and a baked guard.
struct Step<'a> {
    node: &'a Node,
    decision: Decision,
    reason: String,
    supervise: bool,
}

/// The emitted artifact — the file to write plus its audit and effective policy.
#[derive(Debug, Clone, Serialize)]
pub struct EmittedArtifact {
    pub target_label: &'static str,
    pub filename: String,
    pub contents: String,
    pub mode: String,
    pub audit: AuditLog,
    pub effective: EffectivePolicy,
    pub credential_slots: Vec<String>,
}

/// Emit a guardrailed slice. Refuses (errors) if any step exceeds the floor
/// (`DENY`) — "the SVM refuses to emit an artifact that tries to widen the floor"
/// (spec 06).
pub fn emit(
    bc: &Bc,
    spec: &SliceSpec,
    target: Target,
    mode: Mode,
    vault: &Vault,
) -> Result<EmittedArtifact> {
    // Emit is web-app-only — other profiles have no executable payload (spec 05).
    if bc.manifest.profile != PROFILE_WEB_APP {
        return Err(SmoothieError::InvalidArgument(format!(
            "emit is only available for the web-app profile (this BC is {:?})",
            bc.manifest.profile
        )));
    }

    let nodes = resolve_slice(bc, spec)?;
    let eff = EffectivePolicy::effective(bc);

    // Classify every step against the floor-intersected policy; audit each.
    let mut audit = AuditLog::default();
    let mut steps: Vec<Step> = Vec::new();
    for node in &nodes {
        let c = classify(node, &eff);
        let action = node.action.as_ref().map(action_text).unwrap_or_else(|| "(no action)".into());
        audit.push(AuditEntry::from_classification(&c, action));
        steps.push(Step { node, decision: c.decision, reason: c.reason, supervise: c.supervise });
    }

    // Refuse to emit anything that exceeds the floor.
    if audit.has_denials() {
        let denied: Vec<String> = audit
            .entries
            .iter()
            .filter(|e| e.decision == Decision::Deny)
            .map(|e| format!("{} ({})", e.node_id, e.reason))
            .collect();
        return Err(SmoothieError::General(format!(
            "emit refused: {} step(s) exceed the safety floor: {}",
            denied.len(),
            denied.join("; ")
        )));
    }

    // Credential slots: env-references in fill values become run-time slots; the
    // secret value is NEVER inlined (spec 06 · §2).
    let cred_refs = credential_refs(&nodes);
    let credential_slots: Vec<String> = cred_refs.iter().map(CredentialRef::slot).collect();

    // Seed the redactor with any resolvable secret values + policy patterns, so
    // nothing secret reaches the artifact or the audit even defensively.
    let redact_patterns = bc
        .policy
        .secrets
        .as_ref()
        .map(|s| s.redact_patterns.clone())
        .unwrap_or_default();
    let redactor = Redactor::new(vault.secret_values(&cred_refs), redact_patterns);

    let slice_title = slice_title(bc, spec);
    let raw = match target {
        Target::Skill => skill::render(bc, &slice_title, &steps, &eff, mode, &credential_slots),
        Target::Test => test::render(bc, &slice_title, &steps, mode, &credential_slots),
    };
    let contents = redactor.redact(&raw);

    let filename = match target {
        Target::Skill => format!("{}.skill.md", slug(&slice_title)),
        Target::Test => format!("{}.spec.ts", slug(&slice_title)),
    };

    Ok(EmittedArtifact {
        target_label: match target {
            Target::Skill => "skill",
            Target::Test => "test",
        },
        filename,
        contents,
        mode: mode_str(mode).to_string(),
        audit,
        effective: eff,
        credential_slots,
    })
}

/// Resolve a slice spec to an ordered, de-duplicated list of nodes.
fn resolve_slice<'a>(bc: &'a Bc, spec: &SliceSpec) -> Result<Vec<&'a Node>> {
    let ids: Vec<String> = match spec {
        SliceSpec::Nodes(ids) => ids.clone(),
        SliceSpec::Outline(oid) => {
            let outline = bc
                .outlines
                .get(oid)
                .ok_or_else(|| SmoothieError::FileNotFound(format!("outline {oid:?}")))?;
            let mut ids = Vec::new();
            for scene in &outline.scenes {
                ids.extend(scene.node_ids.iter().cloned());
            }
            ids
        }
    };
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let node = bc
            .graph
            .nodes
            .get(&id)
            .ok_or_else(|| SmoothieError::FileNotFound(format!("node {id:?}")))?;
        out.push(node);
    }
    if out.is_empty() {
        return Err(SmoothieError::InvalidArgument(
            "slice resolves to zero nodes".to_string(),
        ));
    }
    Ok(out)
}

fn credential_refs(nodes: &[&Node]) -> Vec<CredentialRef> {
    let mut refs = Vec::new();
    for n in nodes {
        if let Some(Action::Fill { value, .. }) = &n.action
            && let Some(c) = CredentialRef::parse(value)
            && !refs.contains(&c)
        {
            refs.push(c);
        }
    }
    refs
}

fn slice_title(bc: &Bc, spec: &SliceSpec) -> String {
    match spec {
        SliceSpec::Outline(oid) => bc
            .outlines
            .get(oid)
            .map(|o| o.title.clone())
            .unwrap_or_else(|| oid.clone()),
        SliceSpec::Nodes(ids) => ids.join("+"),
    }
}

/// A deterministic, filesystem-safe slug.
fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}
