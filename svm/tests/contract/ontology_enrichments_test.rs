//! Contract tests for the §10 enrichments — Phase 6's gate (IMPLEMENTATION.md ·
//! Phase 6; spec 09 §6.5). Each enrichment is additive (a valid ontology needs none
//! of them) and independently gated: interfaces (+ conformance), reducers, derived
//! properties, structs (+ main field), and layered security.

use std::path::PathBuf;

use assert_cmd::Command;
use serde_json::Value;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ontology").join(name)
}

/// Run `svm ontology <args...> --ont <fixture> --json` → parsed JSON (asserts success).
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
    let out = Command::cargo_bin("svm")
        .unwrap()
        .arg("validate")
        .arg(fixture(fixture_name))
        .arg("--json")
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let codes = report["errors"].as_array().map(|e| e.iter().map(|x| x["code"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default();
    (out.status.success(), codes)
}

// ── interfaces ──

#[test]
fn interfaces_are_listed_with_implementers() {
    let ifaces = q("enrichments.json", &["interfaces"]);
    let named = &ifaces.as_array().unwrap()[0];
    assert_eq!(named["name"], "Named");
    let by: Vec<&str> = named["implemented_by"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
    assert!(by.contains(&"et_segment") && by.contains(&"et_company"), "got {by:?}");
}

#[test]
fn entities_can_be_filtered_by_interface() {
    let ents = q("enrichments.json", &["entities", "--interface", "Named"]);
    assert_eq!(ents.as_array().unwrap().len(), 4); // every entity's type implements Named
}

#[test]
fn interface_conformance_is_enforced() {
    // A type that `extends` an interface but whose entities lack the interface's
    // required property is rejected (G2).
    let (ok, codes) = validate_codes("enrichments-bad-interface.json");
    assert!(!ok, "must be rejected");
    assert!(codes.contains(&"type".to_string()), "expected a 'type' violation, got {codes:?}");
}

// ── reducers ──

#[test]
fn reducer_selects_the_head_value() {
    // sales_usd_m has values [6500, 7200] and a `max` reducer → head is 7200.
    let e = q("enrichments.json", &["entity", "e_seg_ci"]);
    assert_eq!(e["heads"]["sales_usd_m"], serde_json::json!(7200));
    // The full list stays queryable.
    assert_eq!(e["properties"]["sales_usd_m"].as_array().unwrap().len(), 2);
}

// ── derived properties ──

#[test]
fn derived_property_is_computed_over_links() {
    // segment_count = count of inbound belongs_to links to the company (2 segments).
    let e = q("enrichments.json", &["entity", "e_company"]);
    assert_eq!(e["derived"]["segment_count"], serde_json::json!(2));
}

// ── structs ──

#[test]
fn struct_main_field_is_surfaced() {
    let e = q("enrichments.json", &["entity", "e_company"]);
    // The struct value is stored whole...
    assert_eq!(e["properties"]["headquarters"].as_array().unwrap()[0]["value"]["city"], "Peoria");
    // ...and the main field is surfaced as the head display value.
    assert_eq!(e["heads"]["headquarters"], "Peoria");
}

#[test]
fn struct_conformance_is_enforced() {
    // The valid enrichments fixture (a struct with its required field) validates.
    let (ok, _) = validate_codes("enrichments.json");
    assert!(ok, "enrichments fixture with a well-formed struct should validate");
}

// ── layered security ──

#[test]
fn entity_level_security_withholds_all_values() {
    // e_seg_ci carries an entity-level security_id → every value withheld (no --reveal).
    let e = q("security-entity.json", &["entity", "e_seg_ci"]);
    assert_eq!(e["restricted"], Value::Bool(true));
    assert_eq!(e["properties"]["name"].as_array().unwrap()[0]["withheld"], Value::Bool(true));
    assert_eq!(e["properties"]["sales_usd_m"].as_array().unwrap()[0]["withheld"], Value::Bool(true));
}
