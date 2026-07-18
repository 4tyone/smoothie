//! Contract tests for `svm ontology …` — Phase 5's gate (IMPLEMENTATION.md · Phase 5;
//! spec 09 §6.4). Asserts:
//!   - query parity — the reader serves what the producer wrote (types, entities,
//!     links, facts, the resolution graph);
//!   - a RECEIPT on every grounded answer (spec 06 §4);
//!   - the resolution UNION at read time — a canonical entity shows its members'
//!     aliases (spec 01 §7);
//!   - FAIL-CLOSED security — a restricted value is withheld without `--reveal` and
//!     revealed with it (spec 06 §6).

use std::path::PathBuf;

use assert_cmd::Command;
use serde_json::Value;

fn golden() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("schema/examples/ontology.golden.json")
}
fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ontology").join(name)
}

/// Run `svm ontology <args...> --ont <path> --json` and parse the JSON output.
fn q(path: &PathBuf, args: &[&str]) -> Value {
    let out = Command::cargo_bin("svm")
        .unwrap()
        .arg("ontology")
        .args(args)
        .arg("--ont")
        .arg(path)
        .arg("--json")
        .output()
        .expect("failed to run svm ontology");
    assert!(out.status.success(), "svm ontology {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).expect("ontology query should emit JSON")
}

#[test]
fn parity_types_and_entities() {
    let types = q(&golden(), &["types"]);
    let names: Vec<&str> = types.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"Segment") && names.contains(&"Company"), "got {names:?}");

    let entities = q(&golden(), &["entities"]);
    assert_eq!(entities.as_array().unwrap().len(), 4);
}

#[test]
fn entity_applies_resolution_union_and_carries_receipts() {
    let e = q(&golden(), &["entity", "e_company"]);
    // Read-time union: the canonical shows BOTH surface names as aliases (spec 01 §7).
    let aliases: Vec<&str> = e["aliases"].as_array().unwrap().iter().map(|a| a["text"].as_str().unwrap()).collect();
    assert!(aliases.contains(&"Caterpillar Inc.") && aliases.contains(&"Caterpillar"), "got {aliases:?}");
    // A receipt on the answer (spec 06 §4).
    assert!(!e["receipts"].as_array().unwrap().is_empty());
    assert_eq!(e["resolved_from"].as_array().unwrap().len(), 1);
}

#[test]
fn facts_have_a_receipt_on_every_answer() {
    let facts = q(&golden(), &["facts", "e_company"]);
    let arr = facts.as_array().unwrap();
    // The canonical's facts include the member's fact (union grounding).
    let ids: Vec<&str> = arr.iter().map(|f| f["fact_id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"f_company") && ids.contains(&"f_company_alt"), "got {ids:?}");
    // Every fact carries at least one receipt.
    for f in arr {
        assert!(!f["receipts"].as_array().unwrap().is_empty(), "fact {} had no receipt", f["fact_id"]);
    }
}

#[test]
fn links_and_traverse_are_receipted_and_reach_neighbors() {
    let links = q(&golden(), &["links", "e_seg_ci"]);
    let arr = links.as_array().unwrap();
    assert!(!arr.is_empty());
    for l in arr {
        assert!(!l["receipts"].as_array().unwrap().is_empty());
    }
    assert!(arr.iter().any(|l| l["neighbor"] == "e_company"));

    let trav = q(&golden(), &["traverse", "e_seg_ci", "--depth", "3"]);
    let reached: Vec<&str> = trav["reached"].as_array().unwrap().iter().map(|r| r["entity_id"].as_str().unwrap()).collect();
    assert!(reached.contains(&"e_company"), "got {reached:?}");
}

#[test]
fn resolve_reports_canonical_and_member_roles() {
    let canonical = q(&golden(), &["resolve", "e_company"]);
    assert_eq!(canonical["role"], "canonical");
    assert_eq!(canonical["members"].as_array().unwrap()[0], "e_company_alt");

    let member = q(&golden(), &["resolve", "e_company_alt"]);
    assert_eq!(member["role"], "member");
    assert_eq!(member["canonical"], "e_company");
}

#[test]
fn search_finds_by_alias() {
    let hits = q(&golden(), &["search", "caterpillar"]);
    assert!(!hits.as_array().unwrap().is_empty());
}

#[test]
fn security_is_fail_closed_without_reveal() {
    // Without --reveal: the restricted sales value is withheld.
    let e = q(&fixture("security.json"), &["entity", "e_seg_ci"]);
    let sales = &e["properties"]["sales_usd_m"].as_array().unwrap()[0];
    assert_eq!(sales["withheld"], Value::Bool(true), "restricted value must be withheld");
    assert!(sales["value"].as_str().unwrap().contains("withheld"));

    // With --reveal: the value is shown.
    let revealed = Command::cargo_bin("svm")
        .unwrap()
        .args(["ontology", "entity", "e_seg_ci", "--reveal", "--ont"])
        .arg(fixture("security.json"))
        .arg("--json")
        .output()
        .unwrap();
    let ev: Value = serde_json::from_slice(&revealed.stdout).unwrap();
    let sales = &ev["properties"]["sales_usd_m"].as_array().unwrap()[0];
    assert_ne!(sales["withheld"], Value::Bool(true));
    assert_eq!(sales["value"], serde_json::json!(6500));
}
