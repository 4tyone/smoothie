//! Credentials — resolved from a **local vault / env**, never from the BC
//! (a shared BC must never carry secrets), and **redacted** from all logs
//! (spec 05 · Credentials; spec 06 · §2).
//!
//! When the SVM emits an executable slice it writes credentials into the
//! artifact's expected **slots** — placeholders the runner fills from the
//! environment — never inlining a secret value into the BC or the artifact.

use serde::Serialize;

/// A credential *reference* — what the BC/Brief may carry. Always a reference,
/// never a value (e.g. `env:BILLING_DEMO`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CredentialRef {
    pub scheme: String,
    pub name: String,
}

impl CredentialRef {
    /// Parse `env:NAME` (the only scheme in v1). Returns `None` for a bare value,
    /// which is treated as not-a-reference and never resolved.
    pub fn parse(s: &str) -> Option<Self> {
        let (scheme, name) = s.split_once(':')?;
        if scheme != "env" || name.is_empty() {
            return None;
        }
        Some(Self { scheme: scheme.to_string(), name: name.to_string() })
    }

    /// The env-var slot an emitted artifact reads at run time (never the value).
    pub fn slot(&self) -> String {
        // Namespaced so emitted artifacts don't collide with unrelated env.
        format!("SVM_CRED_{}", self.name.to_uppercase())
    }
}

/// The local vault: resolves credential references from the process environment.
/// It is the only thing that ever holds a secret value, and only transiently.
#[derive(Debug, Default)]
pub struct Vault;

impl Vault {
    pub fn new() -> Self {
        Vault
    }

    /// Resolve a reference to its secret value from the environment, or `None`.
    /// The returned value must never be written to the BC, an artifact, or a log.
    pub fn resolve(&self, cref: &CredentialRef) -> Option<String> {
        std::env::var(&cref.name).ok().or_else(|| std::env::var(cref.slot()).ok())
    }

    /// Collect the resolvable secret *values* for the given references — used only
    /// to seed the redactor, never persisted.
    pub fn secret_values(&self, refs: &[CredentialRef]) -> Vec<String> {
        refs.iter().filter_map(|c| self.resolve(c)).filter(|v| !v.is_empty()).collect()
    }
}

/// Redacts secret values and policy-declared patterns from any string before it
/// reaches a log or an artifact (spec 06 · §2).
#[derive(Debug, Default, Clone)]
pub struct Redactor {
    /// Literal secret values to scrub (resolved credentials).
    values: Vec<String>,
    /// Substring patterns from `policy.secrets.redact_patterns`.
    patterns: Vec<String>,
}

impl Redactor {
    pub fn new(values: Vec<String>, patterns: Vec<String>) -> Self {
        // Longest-first so we redact the most specific match.
        let mut values = values;
        values.sort_by_key(|v| std::cmp::Reverse(v.len()));
        Self { values, patterns }
    }

    /// Replace every known secret value / pattern occurrence with `‹redacted›`.
    pub fn redact(&self, input: &str) -> String {
        let mut out = input.to_string();
        for v in &self.values {
            if !v.is_empty() {
                out = out.replace(v, "‹redacted›");
            }
        }
        for p in &self.patterns {
            if !p.is_empty() {
                out = out.replace(p, "‹redacted›");
            }
        }
        out
    }
}
