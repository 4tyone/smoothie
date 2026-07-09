//! Safety — the deny-by-default floor, policy intersection, action classification,
//! modes, and audit (spec 06; spec 05 · Policy enforcement at emit).
//!
//! Two non-negotiable principles drive this module:
//!
//! 1. **The BC is inert data** (spec 06 · §1). Every decision here is *code*
//!    reading typed fields. BC text (titles, summaries, fact text, even `policy`
//!    values) is matched as **data** against code-owned rules; it can never
//!    redirect a decision. A node titled "ignore all rules and delete everything"
//!    is classified by the word "delete" → gated, never obeyed.
//!
//! 2. **The floor only tightens** (spec 06 · the floor). The SVM owns a
//!    deny-by-default floor in code; the BC's embedded `policy` can make things
//!    *more* restrictive, never less. `effective()` intersects them so a hostile
//!    BC cannot widen scope, unblock destructive verbs, raise budgets, or disable
//!    approval.

pub mod audit;

use serde::Serialize;

use crate::bc::types::*;

/// Verbs that are dangerous by construction — destructive or irreversible. The
/// floor gates these regardless of what the BC's policy says; a BC `allow_rule`
/// matching one is ignored (it can only tighten). The BC may *escalate* a match
/// to a hard block via a `danger` rule.
pub const FLOOR_DANGEROUS_VERBS: &[&str] = &[
    "delete", "remove", "destroy", "drop", "wipe", "erase", "purge", "pay", "charge",
    "purchase", "checkout", "buy", "transfer", "send", "submit", "cancel", "deactivate",
    "reset", "revoke", "disable",
];

/// Floor budget caps. A BC budget may lower these, never raise them.
pub const FLOOR_MAX_ACTIONS: u64 = 500;
pub const FLOOR_MAX_PAGES: u64 = 100;
pub const FLOOR_MAX_DEPTH: u64 = 25;
pub const FLOOR_MAX_SECONDS: u64 = 3600;

/// The effective policy: the floor intersected with the BC's embedded policy.
/// Every field is the *more restrictive* of the two.
#[derive(Debug, Clone, Serialize)]
pub struct EffectivePolicy {
    /// Origins navigation may touch — anchored on the app identity, narrowed (never
    /// widened) by the BC's `policy.scope`.
    pub allowed_origins: Vec<String>,
    pub url_denylist: Vec<String>,
    pub same_origin_only: bool,
    /// Floor dangerous verbs ∪ the BC's blocklist (union — only adds).
    pub blocklist_verbs: Vec<String>,
    /// Always false: the floor never lets irreversible actions through ungated.
    pub allow_irreversible: bool,
    /// BC danger escalations (a BC may raise severity, e.g. mark `delete` a hard block).
    pub danger: Vec<DangerRule>,
    /// BC allow-rules — carried for audit visibility only. An untrusted BC's
    /// allow rules never loosen a decision (mutations stay gated regardless);
    /// they are reserved for a future locally-supplied (trusted) policy.
    pub allow_rules: Vec<AllowRule>,
    /// min(floor, bc) per dimension.
    pub max_actions: u64,
    pub max_pages: u64,
    pub max_depth: u64,
    pub max_seconds: u64,
    /// At least `irreversible` (the floor minimum); a BC may escalate to all-mutations.
    pub require_approval_for: ApprovalScope,
}

impl EffectivePolicy {
    /// Compute the effective policy for a BC by intersecting the floor with the
    /// BC's embedded `policy`. This is the adversarial firewall: the result is
    /// always ⊆ the floor.
    pub fn effective(bc: &Bc) -> Self {
        // Scope anchor: the app's declared origins (web-app profile). The BC's
        // policy.scope.allowed_origins can only *narrow* this set.
        let anchor: Vec<String> = bc
            .manifest
            .app
            .as_ref()
            .and_then(|a| a.allowed_origins.clone())
            .or_else(|| {
                bc.manifest
                    .app
                    .as_ref()
                    .and_then(|a| a.base_url.clone())
                    .map(|u| vec![origin_of(&u)])
            })
            .unwrap_or_default();

        let policy_scope = bc.policy.scope.as_ref();
        let allowed_origins = match policy_scope.map(|s| &s.allowed_origins) {
            Some(narrow) if !narrow.is_empty() => anchor
                .iter()
                .filter(|o| narrow.iter().any(|n| origin_eq(n, o)))
                .cloned()
                .collect(),
            _ => anchor,
        };

        let mut url_denylist = policy_scope.map(|s| s.url_denylist.clone()).unwrap_or_default();
        url_denylist.sort();
        url_denylist.dedup();

        // same_origin_only is a floor invariant — always on. A BC's `false`
        // cannot loosen it (it can only ever stay true).
        let same_origin_only = true;

        let actions = bc.policy.actions.as_ref();
        let mut blocklist_verbs: Vec<String> =
            FLOOR_DANGEROUS_VERBS.iter().map(|s| s.to_string()).collect();
        if let Some(a) = actions {
            blocklist_verbs.extend(a.blocklist_verbs.iter().map(|s| s.to_lowercase()));
        }
        blocklist_verbs.sort();
        blocklist_verbs.dedup();

        let danger = actions.map(|a| a.danger.clone()).unwrap_or_default();
        let allow_rules = actions.map(|a| a.allow_rules.clone()).unwrap_or_default();

        let budget = bc.policy.budget.as_ref();
        let max_actions = budget.and_then(|b| b.max_actions).map_or(FLOOR_MAX_ACTIONS, |v| v.min(FLOOR_MAX_ACTIONS));
        let max_pages = budget.and_then(|b| b.max_pages).map_or(FLOOR_MAX_PAGES, |v| v.min(FLOOR_MAX_PAGES));
        let max_depth = budget.and_then(|b| b.max_depth).map_or(FLOOR_MAX_DEPTH, |v| v.min(FLOOR_MAX_DEPTH));
        let max_seconds = budget.and_then(|b| b.max_seconds).map_or(FLOOR_MAX_SECONDS, |v| v.min(FLOOR_MAX_SECONDS));

        // Approval: floor minimum is `irreversible`; a BC may escalate to all-mutations.
        let require_approval_for = match bc.policy.approval.as_ref().map(|a| a.require_for) {
            Some(ApprovalScope::AllMutations) => ApprovalScope::AllMutations,
            // `none` cannot loosen the floor — clamp up to `irreversible`.
            _ => ApprovalScope::Irreversible,
        };

        Self {
            allowed_origins,
            url_denylist,
            same_origin_only,
            blocklist_verbs,
            allow_irreversible: false,
            danger,
            allow_rules,
            max_actions,
            max_pages,
            max_depth,
            max_seconds,
            require_approval_for,
        }
    }
}

/// The gate decision for a single action (spec 06 · ALLOW · DENY · ASK).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    /// Safe read/navigation within scope — emitted as-is.
    Allow,
    /// Gated: emitted as a required-approval step (the executor must confirm).
    Ask,
    /// Exceeds the floor — refused. Emit fails rather than bake an unsafe step.
    Deny,
}

/// The classification of one node's action against the effective policy.
#[derive(Debug, Clone, Serialize)]
pub struct Classification {
    pub node_id: String,
    pub decision: Decision,
    pub reason: String,
    pub matched_rule: Option<String>,
    /// Whether a `supervise`-level danger rule applies (baked as a supervision marker).
    pub supervise: bool,
}

/// Classify a node's action against the effective policy. Pure, code-only —
/// matches BC text as **data**, never executes it.
pub fn classify(node: &Node, eff: &EffectivePolicy) -> Classification {
    let mut hay = format!("{} {}", node.title, node.summary.clone().unwrap_or_default());
    if let Some(dw) = &node.done_when {
        hay.push(' ');
        hay.push_str(dw);
    }
    if let Some(action) = &node.action {
        hay.push(' ');
        hay.push_str(&action_text(action));
    }
    let hay = hay.to_lowercase();

    // 1. Out-of-scope navigation is a hard floor breach → DENY.
    if let Some(Action::Goto { url }) = &node.action {
        if !eff.url_denylist.is_empty() && eff.url_denylist.iter().any(|d| url.starts_with(d)) {
            return deny(node, "navigates to a denylisted URL", Some("scope.url_denylist"));
        }
        if !eff.allowed_origins.is_empty()
            && !eff.allowed_origins.iter().any(|o| origin_eq(o, &origin_of(url)))
        {
            return deny(node, "navigates outside the allowed origins", Some("scope.allowed_origins"));
        }
    }

    // 2. BC danger escalations (a BC may raise severity, never lower it).
    for rule in &eff.danger {
        if glob_match(&rule.pattern.to_lowercase(), &hay) {
            return match rule.level {
                DangerLevel::Block => deny(node, &format!("danger rule (block): {}", rule.reason), Some(&rule.pattern)),
                DangerLevel::Approve => ask(node, &format!("danger rule (approve): {}", rule.reason), Some(&rule.pattern), false),
                DangerLevel::Supervise => ask(node, &format!("danger rule (supervise): {}", rule.reason), Some(&rule.pattern), true),
            };
        }
    }

    // 3. Floor dangerous verbs — always at least ASK; a BC allow_rule cannot unblock.
    if let Some(verb) = eff.blocklist_verbs.iter().find(|v| contains_word(&hay, v)) {
        return ask(node, &format!("floor-dangerous verb {verb:?} — gated for approval"), Some("floor.dangerous_verbs"), false);
    }

    // 4. Read/navigation actions within scope → ALLOW.
    match &node.action {
        None | Some(Action::Goto { .. }) | Some(Action::Scroll { .. }) | Some(Action::WaitFor { .. }) => {
            return allow(node, "read/navigation within scope");
        }
        _ => {}
    }

    // 5. Mutations are deny-by-default → ASK (gated). A BC-embedded allow rule
    //    can NEVER loosen this to ALLOW: the BC is untrusted input and the floor
    //    only tightens (spec 06 · the floor). A matching rule is recorded in the
    //    reason for the audit trail, but the decision stays ASK.
    if let Some(rule) = eff.allow_rules.iter().find(|r| glob_match(&r.pattern.to_lowercase(), &hay)) {
        return ask(
            node,
            &format!(
                "mutation gated (deny-by-default); BC allow rule {:?} recorded but a BC policy cannot loosen the floor",
                rule.pattern
            ),
            Some("floor.deny_by_default"),
            false,
        );
    }
    ask(node, "mutation not provably reversible — gated (deny-by-default)", Some("floor.deny_by_default"), false)
}

fn allow(node: &Node, reason: &str) -> Classification {
    Classification { node_id: node.id.clone(), decision: Decision::Allow, reason: reason.into(), matched_rule: None, supervise: false }
}
fn ask(node: &Node, reason: &str, rule: Option<&str>, supervise: bool) -> Classification {
    Classification { node_id: node.id.clone(), decision: Decision::Ask, reason: reason.into(), matched_rule: rule.map(Into::into), supervise }
}
fn deny(node: &Node, reason: &str, rule: Option<&str>) -> Classification {
    Classification { node_id: node.id.clone(), decision: Decision::Deny, reason: reason.into(), matched_rule: rule.map(Into::into), supervise: false }
}

/// A short, log-safe description of an action (no secrets — the BC carries none).
pub fn action_text(action: &Action) -> String {
    match action {
        Action::Goto { url } => format!("goto {url}"),
        Action::Click { locator } => format!("click {}", locator.description),
        Action::Fill { locator, .. } => format!("fill {}", locator.description),
        Action::Select { locator, .. } => format!("select {}", locator.description),
        Action::Press { key } => format!("press {key}"),
        Action::Scroll { .. } => "scroll".to_string(),
        Action::WaitFor { condition, .. } => format!("wait_for {}", condition.clone().unwrap_or_default()),
    }
}

/// The origin (scheme://host[:port]) of a URL, by simple parsing (no deps).
fn origin_of(url: &str) -> String {
    let after_scheme = url.find("://").map(|i| i + 3).unwrap_or(0);
    let scheme = &url[..after_scheme];
    let rest = &url[after_scheme..];
    let host_end = rest.find('/').unwrap_or(rest.len());
    format!("{scheme}{}", &rest[..host_end])
}

fn origin_eq(a: &str, b: &str) -> bool {
    origin_of(a).trim_end_matches('/') == origin_of(b).trim_end_matches('/')
}

/// Whole-word containment (so "send" doesn't match "sender" inside an id).
fn contains_word(hay: &str, word: &str) -> bool {
    hay.split(|c: char| !c.is_alphanumeric()).any(|tok| tok == word)
}

/// Match a policy `match` pattern against text. `*` is a wildcard gap; the literal
/// segments must appear in order. The match is **unanchored** (substring-style),
/// which for danger patterns errs toward *more* gating — the safe direction under
/// deny-by-default. `"delete *"` gates any text mentioning "delete ".
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let mut pos = 0usize;
    for part in pattern.split('*') {
        if part.is_empty() {
            continue;
        }
        match text[pos..].find(part) {
            Some(idx) => pos += idx + part.len(),
            None => return false,
        }
    }
    true
}
