//! Audit — every enforcement decision is logged with the proposed action, its
//! classification, the matched rule, and a reason (spec 06 · Audit). Secrets are
//! redacted from all of it (the BC carries none by construction; the redactor
//! guards against credential values reaching a log).

use serde::Serialize;

use super::{Classification, Decision};

/// One audited enforcement decision.
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub node_id: String,
    /// A short, secret-free description of the proposed action.
    pub action: String,
    pub decision: Decision,
    pub matched_rule: Option<String>,
    pub reason: String,
    pub supervise: bool,
}

impl AuditEntry {
    pub fn from_classification(c: &Classification, action: String) -> Self {
        Self {
            node_id: c.node_id.clone(),
            action,
            decision: c.decision,
            matched_rule: c.matched_rule.clone(),
            reason: c.reason.clone(),
            supervise: c.supervise,
        }
    }
}

/// The audit trail for one emit: a complete record of what was attempted and what
/// was decided.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AuditLog {
    pub entries: Vec<AuditEntry>,
}

impl AuditLog {
    pub fn push(&mut self, entry: AuditEntry) {
        self.entries.push(entry);
    }

    pub fn counts(&self) -> (usize, usize, usize) {
        let mut allow = 0;
        let mut ask = 0;
        let mut deny = 0;
        for e in &self.entries {
            match e.decision {
                Decision::Allow => allow += 1,
                Decision::Ask => ask += 1,
                Decision::Deny => deny += 1,
            }
        }
        (allow, ask, deny)
    }

    pub fn has_denials(&self) -> bool {
        self.entries.iter().any(|e| e.decision == Decision::Deny)
    }
}
