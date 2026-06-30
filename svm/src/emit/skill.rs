//! Render a guardrailed **skill** artifact (markdown) from a slice. Deterministic
//! and side-effect-free. Guardrails are baked in: gated/`ASK` steps are marked
//! required-approval, `supervise` steps marked, scope/budget inlined, the mode
//! declared, and credential slots referenced (never secret values).

use crate::bc::types::*;
use crate::policy::{action_text, Decision, EffectivePolicy};

use super::{mode_str, Step};

pub(super) fn render(
    bc: &Bc,
    slice_title: &str,
    steps: &[Step],
    eff: &EffectivePolicy,
    mode: Mode,
    credential_slots: &[String],
) -> String {
    let mut s = String::new();
    let app = bc.manifest.app.as_ref();
    let app_name = app.and_then(|a| a.name.clone()).unwrap_or_else(|| bc.manifest.bc_id.clone());

    s.push_str(&format!("# Skill — {slice_title}\n\n"));
    s.push_str(&format!(
        "> Emitted by the SVM from BC `{}` (app: {}). Guardrails are baked in; \
         the executor must honor them. The SVM does not drive anything.\n\n",
        bc.manifest.bc_id, app_name
    ));

    // ── Safety header (the guardrails travel with the artifact) ──
    s.push_str("## Safety (enforced by the executor)\n\n");
    s.push_str(&format!("- **Mode:** `{}`\n", mode_str(mode)));
    if !eff.allowed_origins.is_empty() {
        s.push_str(&format!("- **Allowed origins:** {}\n", eff.allowed_origins.join(", ")));
    }
    s.push_str(&format!("- **Same-origin only:** {}\n", eff.same_origin_only));
    if !eff.url_denylist.is_empty() {
        s.push_str(&format!("- **URL denylist:** {}\n", eff.url_denylist.join(", ")));
    }
    s.push_str(&format!(
        "- **Budget:** ≤{} actions, ≤{} pages, ≤{} depth, ≤{}s\n",
        eff.max_actions, eff.max_pages, eff.max_depth, eff.max_seconds
    ));
    s.push_str(&format!(
        "- **Approval required for:** {}\n",
        match eff.require_approval_for {
            ApprovalScope::None => "none",
            ApprovalScope::Irreversible => "irreversible actions",
            ApprovalScope::AllMutations => "all mutations",
        }
    ));
    s.push_str("- **Irreversible actions:** always gated (`ASK`) — the floor never allows them ungated.\n");
    if !credential_slots.is_empty() {
        s.push_str(&format!(
            "- **Credential slots (filled from env at run time, never inlined):** {}\n",
            credential_slots.join(", ")
        ));
    }
    s.push('\n');

    // ── Steps ──
    s.push_str("## Steps\n\n");
    for (i, step) in steps.iter().enumerate() {
        let n = step.node;
        let action = n.action.as_ref().map(action_text).unwrap_or_else(|| "(no action)".into());
        let marker = match step.decision {
            Decision::Allow => "ALLOW",
            Decision::Ask => "ASK — requires approval",
            Decision::Deny => "DENY", // unreachable: emit refuses on any DENY
        };
        s.push_str(&format!("{}. **{}** — {}\n", i + 1, n.title, action));
        s.push_str(&format!("   - guard: `{marker}`"));
        if step.supervise {
            s.push_str(" · `supervise`");
        }
        s.push_str(&format!(" — {}\n", step.reason));
        if let Some(loc) = action_locator(n.action.as_ref()) {
            s.push_str(&format!("   - locator: {} (`{}={}`)\n", loc.description, by_str(loc.primary.by), loc.primary.value));
        }
        for chk in &n.checks {
            s.push_str(&format!("   - check: {}\n", describe_check(chk)));
        }
        s.push_str(&format!("   - fidelity: {} · receipts: {}\n", fidelity_str(n.fidelity), n.source_refs.len()));
    }

    s.push_str("\n## Provenance\n\nEvery step traces to receipts in the source BC; nothing here is ungrounded. ");
    s.push_str("This artifact is a pure function of the BC — re-emitting from the same BC yields the same file.\n");
    s
}

fn action_locator(action: Option<&Action>) -> Option<&Locator> {
    match action? {
        Action::Click { locator } | Action::Fill { locator, .. } | Action::Select { locator, .. } => Some(locator),
        Action::Scroll { locator, .. } | Action::WaitFor { locator, .. } => locator.as_ref(),
        _ => None,
    }
}

fn describe_check(c: &Check) -> String {
    match c {
        Check::Visible { locator } => format!("visible: {}", locator.description),
        Check::Exists { locator } => format!("exists: {}", locator.description),
        Check::TextMatches { expected, .. } => format!("text matches {expected:?}"),
        Check::UrlMatches { expected } => format!("url matches {expected:?}"),
    }
}

fn by_str(by: LocatorBy) -> &'static str {
    match by {
        LocatorBy::Role => "role",
        LocatorBy::Testid => "testid",
        LocatorBy::Label => "label",
        LocatorBy::Text => "text",
        LocatorBy::Css => "css",
    }
}

fn fidelity_str(f: Fidelity) -> &'static str {
    match f {
        Fidelity::Confirmed => "confirmed",
        Fidelity::Claimed => "claimed",
        Fidelity::Guessed => "guessed",
        Fidelity::Absent => "absent",
    }
}
