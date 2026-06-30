//! Contract tests for `svm emit` — the web-app deliverable (spec 05/06).
//! Emits a guardrailed skill AND a deterministic test from a golden BC.

use assert_cmd::Command;
use serde_json::Value;
use std::path::PathBuf;

fn golden() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("schema/examples/bc.golden.json")
}

fn emit_stdout(target: &str, extra: &[&str]) -> String {
    let out = Command::cargo_bin("svm")
        .unwrap()
        .args(["emit", target, "--outline", "o-dunning", "--bc"])
        .arg(golden())
        .args(["--stdout"])
        .args(extra)
        .output()
        .expect("run emit");
    assert!(out.status.success(), "emit failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn emits_a_guardrailed_skill() {
    let skill = emit_stdout("skill", &[]);
    assert!(skill.contains("# Skill"));
    assert!(skill.contains("## Safety"));
    assert!(skill.contains("Mode:"));
    assert!(skill.contains("Allowed origins"));
    // Guardrails reference the floor's irreversible-gating.
    assert!(skill.contains("always gated"));
}

#[test]
fn emits_a_deterministic_test() {
    let test = emit_stdout("test", &["--mode", "read-only"]);
    assert!(test.contains("import { test, expect }"));
    assert!(test.contains("runStep")); // the baked guardrail harness
    assert!(test.contains("await page.goto"));
    assert!(test.contains("toBeVisible") || test.contains("toHaveURL"));
}

#[test]
fn emit_is_a_pure_function_of_the_bc() {
    // Same BC + same request → byte-identical artifact (determinism posture).
    assert_eq!(emit_stdout("skill", &[]), emit_stdout("skill", &[]));
    assert_eq!(
        emit_stdout("test", &["--mode", "dry-run"]),
        emit_stdout("test", &["--mode", "dry-run"])
    );
}

#[test]
fn emit_writes_an_artifact_to_disk() {
    let dir = tempfile::tempdir().unwrap();
    let out = Command::cargo_bin("svm")
        .unwrap()
        .args(["emit", "test", "--outline", "o-dunning", "--bc"])
        .arg(golden())
        .args(["--out"])
        .arg(dir.path())
        .arg("--json")
        .output()
        .expect("run emit");
    assert!(out.status.success());
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let written = report["written_to"].as_str().unwrap();
    assert!(std::path::Path::new(written).exists(), "artifact should exist on disk");
    assert_eq!(report["deny"], 0);
}

#[test]
fn emit_refuses_for_non_webapp_profile() {
    // A valid `corpus` BC has no executable payload — emit must refuse.
    let corpus = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus-valid.json");
    Command::cargo_bin("svm")
        .unwrap()
        .args(["emit", "skill", "--node", "n1", "--bc"])
        .arg(corpus)
        .arg("--stdout")
        .assert()
        .failure()
        .stderr(predicates::str::contains("web-app profile"));
}
