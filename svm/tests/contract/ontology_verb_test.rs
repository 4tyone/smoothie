//! Contract tests for the verb layer, part 1 — Phase 8's gate (IMPLEMENTATION.md ·
//! Phase 8; spec 10 §9.1). Logic units and events are additive primitives with their
//! own grounding (events carry receipts); the conformance report distinguishes the
//! de jure (SOP), de facto (events), and espoused (interview) processes per step, and
//! surfaces conflicts — never averaging them (spec 10 §2).

use std::path::PathBuf;

use assert_cmd::Command;
use serde_json::Value;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ontology").join(name)
}

fn q(fixture_name: &str, args: &[&str]) -> Value {
    let out = Command::cargo_bin("svm")
        .unwrap()
        .arg("ontology")
        .args(args)
        .arg("--ont")
        .arg(fixture(fixture_name))
        .arg("--json")
        .output()
        .expect("failed to run svm ontology");
    assert!(out.status.success(), "svm ontology {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).expect("ontology query should emit JSON")
}

fn validate_codes(fixture_name: &str) -> (bool, Vec<String>) {
    let out = Command::cargo_bin("svm").unwrap().arg("validate").arg(fixture(fixture_name)).arg("--json").output().unwrap();
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let codes = report["errors"].as_array().map(|e| e.iter().map(|x| x["code"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default();
    (out.status.success(), codes)
}

#[test]
fn verb_fixture_is_valid_and_events_are_receipted() {
    let (ok, _) = validate_codes("verb.json");
    assert!(ok, "the verb-layer fixture should validate");
}

#[test]
fn an_ungrounded_event_is_rejected() {
    // An event with no receipt fails G1 grounding (the verb layer is grounded too).
    let (ok, codes) = validate_codes("verb-bad-event.json");
    assert!(!ok);
    assert!(codes.contains(&"grounding".to_string()), "expected a 'grounding' violation, got {codes:?}");
}

#[test]
fn logic_units_are_listed_with_state_and_trust_class() {
    let lus = q("verb.json", &["logic-units"]);
    let lu = &lus.as_array().unwrap()[0];
    assert_eq!(lu["logic_unit_id"], "lu_triage");
    assert_eq!(lu["state"], "observed");
    assert_eq!(lu["trust_class"], "judged");
    assert_eq!(lu["step_count"], 4);
    assert_eq!(lu["event_count"], 3);
}

#[test]
fn g8_rejects_an_executable_logic_unit_with_a_fiction_step() {
    // Phase 9 (spec 10 §2, §9.2): an `executable` logic unit whose step is attested
    // only by an SOP (never in the logs), or that carries a conflict, fails G8.
    let (ok, codes) = validate_codes("verb-executable-fiction.json");
    assert!(!ok, "must be rejected");
    assert!(codes.contains(&"eligibility".to_string()), "expected an 'eligibility' violation, got {codes:?}");
}

#[test]
fn g9_rejects_autonomy_above_the_floor_and_out_of_surface_writes() {
    // Phase 10 (spec 10 §5, §9.3): an irreversible action cannot exceed its floor, and
    // an output writing outside the declared kinetic surface is refused fail-closed.
    let (ok, codes) = validate_codes("g9-bad.json");
    assert!(!ok, "must be rejected");
    assert!(codes.iter().filter(|c| c.as_str() == "autonomy").count() >= 2, "expected two 'autonomy' violations, got {codes:?}");
}

#[test]
fn g9_accepts_a_within_floor_within_surface_contract() {
    let (ok, _) = validate_codes("g9-ok.json");
    assert!(ok, "a within-floor, within-surface executable contract should validate");
}

#[test]
fn conformance_report_distinguishes_de_jure_from_de_facto() {
    // The gate (spec 10 §9.1): the report separates documented-but-not-observed from
    // observed-but-not-documented, and flags conflicts — it never averages them.
    let report = q("verb.json", &["conformance", "--logic-unit", "lu_triage"]);
    let lu = &report.as_array().unwrap()[0];

    let statuses: Vec<&str> = lu["steps"].as_array().unwrap().iter().map(|s| s["status"].as_str().unwrap()).collect();
    assert_eq!(statuses, vec!["confirmed", "de_jure_only", "de_facto_only", "conflict"]);

    let s = &lu["summary"];
    assert_eq!(s["de_jure_only"], 1); // documented in the SOP, never seen in the logs
    assert_eq!(s["de_facto_only"], 1); // seen in the logs, never documented
    assert_eq!(s["confirmed"], 1);
    assert_eq!(s["conflict"], 1); // the SOP and the logs disagree
    // Both divergence classes are present as distinct categories (not collapsed).
    assert!(s["de_jure_only"].as_u64().unwrap() > 0 && s["de_facto_only"].as_u64().unwrap() > 0);
}
