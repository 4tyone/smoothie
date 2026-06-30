//! Unit tests for credentials — references resolve from env, never the BC; secret
//! values are redacted; emitted slots never carry the value (spec 05/06 · §2).

use smoothie::credentials::{CredentialRef, Redactor, Vault};

#[test]
fn parses_only_env_references() {
    let c = CredentialRef::parse("env:BILLING_DEMO").unwrap();
    assert_eq!(c.name, "BILLING_DEMO");
    assert_eq!(c.slot(), "SVM_CRED_BILLING_DEMO");
    // A bare value is not a reference and is never resolved as one.
    assert!(CredentialRef::parse("hunter2").is_none());
    assert!(CredentialRef::parse("env:").is_none());
}

#[test]
fn vault_resolves_from_env_and_seeds_redactor() {
    // SAFETY: single-threaded test; we set + read one var.
    unsafe { std::env::set_var("SVM_TEST_SECRET", "s3cr3t-value") };
    let cref = CredentialRef::parse("env:SVM_TEST_SECRET").unwrap();
    let vault = Vault::new();
    assert_eq!(vault.resolve(&cref).as_deref(), Some("s3cr3t-value"));

    let redactor = Redactor::new(vault.secret_values(&[cref]), vec![]);
    let log = "logging in with s3cr3t-value now";
    assert!(!redactor.redact(log).contains("s3cr3t-value"));
    assert!(redactor.redact(log).contains("‹redacted›"));
    unsafe { std::env::remove_var("SVM_TEST_SECRET") };
}

#[test]
fn redactor_applies_policy_patterns() {
    let redactor = Redactor::new(vec![], vec!["password".to_string()]);
    assert!(!redactor.redact("the password field").contains("password"));
}
