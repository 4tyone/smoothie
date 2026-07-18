//! Contract tests for `svm validate --target ontology` — Phase 1's gate
//! (IMPLEMENTATION.md · Phase 1; spec 01 §8).
//!
//! Proves the `ontology.v1` contract before the producer track exists:
//!   - the hand-authored golden ontology passes (exit 0);
//!   - one deliberately-broken fixture per gate G1-G7 is rejected (exit != 0) for
//!     the right reason (grounding · type · ref · identity · resolution · security ·
//!     envelope), with the offending id named.

use std::path::PathBuf;

use assert_cmd::Command;
use serde_json::Value;

/// The repo-root golden ontology (`schema/examples/ontology.golden.json`).
fn golden() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("schema/examples/ontology.golden.json")
}

/// A broken fixture under `svm/tests/fixtures/ontology/`.
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/ontology")
        .join(name)
}

/// Run `svm validate --target ontology <path> --json` → (success, parsed report).
fn run_validate(path: &PathBuf) -> (bool, Value) {
    let out = Command::cargo_bin("svm")
        .unwrap()
        .arg("validate")
        .arg(path)
        .arg("--json")
        .output()
        .expect("failed to run svm validate");
    let report: Value =
        serde_json::from_slice(&out.stdout).expect("validate --json should emit JSON on stdout");
    (out.status.success(), report)
}

/// The set of violation codes the report carries.
fn codes(report: &Value) -> Vec<String> {
    report["errors"]
        .as_array()
        .map(|errs| {
            errs.iter()
                .map(|e| e["code"].as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn assert_rejected_with(fixture_name: &str, expected_code: &str) {
    let (success, report) = run_validate(&fixture(fixture_name));
    assert!(!success, "{fixture_name} must be rejected");
    assert!(
        codes(&report).contains(&expected_code.to_string()),
        "expected a {expected_code:?} violation in {fixture_name}, got {:?}",
        codes(&report)
    );
}

#[test]
fn golden_ontology_is_valid() {
    let (success, report) = run_validate(&golden());
    assert!(
        success,
        "golden ontology should validate, got errors: {:?}",
        report["errors"]
    );
    assert_eq!(report["valid"], Value::Bool(true));
    assert_eq!(report["error_count"], 0);
}

#[test]
fn golden_ontology_human_output_is_clean() {
    Command::cargo_bin("svm")
        .unwrap()
        .arg("validate")
        .arg(golden())
        .assert()
        .success()
        .stdout(predicates::str::contains("valid ontology.v1 ontology"));
}

#[test]
fn rejects_g1_grounding() {
    assert_rejected_with("g1-grounding.json", "grounding");
}

#[test]
fn rejects_g2_type_conformance() {
    assert_rejected_with("g2-type.json", "type");
}

#[test]
fn rejects_g3_referential_integrity() {
    assert_rejected_with("g3-ref.json", "ref");
}

#[test]
fn rejects_g4_identity_stability() {
    assert_rejected_with("g4-identity.json", "identity");
}

#[test]
fn rejects_g5_resolution_integrity() {
    assert_rejected_with("g5-resolution.json", "resolution");
}

#[test]
fn rejects_g6_security() {
    assert_rejected_with("g6-security.json", "security");
}

#[test]
fn rejects_g7_envelope() {
    assert_rejected_with("g7-envelope.json", "envelope");
}
