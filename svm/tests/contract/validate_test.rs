//! Contract tests for `svm validate` — Phase 0's test gate (PHASES · Phase 0).
//!
//! Proves the seam before either producer half exists:
//!   - the hand-authored golden BC passes (`svm validate <golden>` → exit 0);
//!   - deliberately-broken BCs are rejected (exit ≠ 0) for the right reason:
//!     missing receipt · confirmed without a resolution receipt · empty locator,
//!     plus laundered trust, unknown top-level field, and bad schema version.

use std::path::PathBuf;

use assert_cmd::Command;
use serde_json::Value;

/// The repo-root golden BC (`schema/examples/bc.golden.json`).
fn golden() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("schema/examples/bc.golden.json")
}

/// A broken fixture under `svm/tests/fixtures/`.
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Run `svm validate <path> --json` and return (success, parsed JSON report).
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

#[test]
fn golden_bc_is_valid() {
    let (success, report) = run_validate(&golden());
    assert!(
        success,
        "golden BC should validate, got errors: {:?}",
        report["errors"]
    );
    assert_eq!(report["valid"], Value::Bool(true));
    assert_eq!(report["error_count"], 0);
}

#[test]
fn golden_bc_human_output_is_clean() {
    Command::cargo_bin("svm")
        .unwrap()
        .arg("validate")
        .arg(golden())
        .assert()
        .success()
        .stdout(predicates::str::contains("valid bc.v1 BC"));
}

#[test]
fn rejects_missing_receipt() {
    let (success, report) = run_validate(&fixture("missing-receipt.json"));
    assert!(!success, "a node with no source_refs must be rejected");
    assert!(
        codes(&report).contains(&"receipt".to_string()),
        "expected a 'receipt' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_confirmed_without_resolution_receipt() {
    let (success, report) = run_validate(&fixture("confirmed-no-receipt.json"));
    assert!(
        !success,
        "a confirmed node without a crawl/live/resolve receipt must be rejected"
    );
    assert!(
        codes(&report).contains(&"fidelity".to_string()),
        "expected a 'fidelity' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_empty_locator() {
    let (success, report) = run_validate(&fixture("empty-locator.json"));
    assert!(!success, "an empty Locator.primary.value must be rejected");
    assert!(
        codes(&report).contains(&"locator".to_string()),
        "expected a 'locator' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_laundered_trust() {
    let (success, report) = run_validate(&fixture("laundered-trust.json"));
    assert!(
        !success,
        "an outline more trusted than its nodes must be rejected"
    );
    assert!(
        codes(&report).contains(&"laundered-trust".to_string()),
        "expected a 'laundered-trust' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_unknown_top_level_field() {
    let (success, report) = run_validate(&fixture("unknown-top-level.json"));
    assert!(!success, "ad hoc top-level fields must be rejected");
    assert!(
        codes(&report).contains(&"schema".to_string()),
        "expected a 'schema' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_bad_schema_version() {
    let (success, report) = run_validate(&fixture("bad-schema-version.json"));
    assert!(!success, "an unsupported schema version must be rejected");
    assert!(
        codes(&report).contains(&"schema".to_string()),
        "expected a 'schema' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_companion_path_escaping_the_bc_dir() {
    // A hostile BC must not point a companion receipt outside its bundle — that
    // breaks self-containment and turns validation into a filesystem probe.
    let (success, report) = run_validate(&fixture("escaping-companion.json"));
    assert!(!success, "a companion path traversing outside the BC dir must be rejected");
    assert!(
        codes(&report).contains(&"receipt".to_string()),
        "expected a 'receipt' violation, got {:?}",
        codes(&report)
    );
}

#[test]
fn rejects_confidence_out_of_range() {
    // `confidence` is a probability; the contract bounds it to [0, 1]. A producer
    // bug emitting 5.0 must be rejected on read, not served.
    let (success, report) = run_validate(&fixture("confidence-out-of-range.json"));
    assert!(!success, "a fact confidence outside [0, 1] must be rejected");
    assert!(
        codes(&report).contains(&"schema".to_string()),
        "expected a 'schema' violation, got {:?}",
        codes(&report)
    );
}
