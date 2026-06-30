//! Library-level unit tests for the `bc` module: the serde mirror and the
//! provenance-guarantee gates (spec 02). These exercise the validator directly
//! (no CLI), complementing the `svm validate` contract tests.

use std::path::PathBuf;

use smoothie::bc::types::*;
use smoothie::bc::validate::{parse, validate};

fn golden_json() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("schema/examples/bc.golden.json");
    std::fs::read_to_string(path).expect("read golden BC")
}

#[test]
fn golden_parses_and_validates_in_memory() {
    let bc = parse(&golden_json()).expect("golden parses");
    // base_dir = None skips on-disk companion checks (we test the gates, not files).
    let report = validate(&bc, None);
    assert!(report.is_valid(), "unexpected errors: {:?}", report.errors);
}

#[test]
fn golden_round_trips_through_serde() {
    let bc = parse(&golden_json()).expect("golden parses");
    let reserialized = serde_json::to_string(&bc).expect("serialize");
    let bc2 = parse(&reserialized).expect("re-parse");
    // The web-app profile, schema version, and counts survive a round trip.
    assert_eq!(bc.schema, bc2.schema);
    assert_eq!(bc.manifest.profile, "web-app");
    assert_eq!(bc.graph.nodes.len(), bc2.graph.nodes.len());
}

#[test]
fn fidelity_rank_orders_trust() {
    assert!(Fidelity::Confirmed.rank() > Fidelity::Claimed.rank());
    assert!(Fidelity::Claimed.rank() > Fidelity::Guessed.rank());
    assert!(Fidelity::Guessed.rank() > Fidelity::Absent.rank());
    assert!(Fidelity::Confirmed.requires_resolution_receipt());
    assert!(!Fidelity::Claimed.requires_resolution_receipt());
}

#[test]
fn only_resolution_spans_are_receipts() {
    assert!(SourceSpan::Crawl { page_id: "p".into(), url: None }.is_resolution_receipt());
    assert!(SourceSpan::Live { note: "n".into() }.is_resolution_receipt());
    assert!(
        SourceSpan::Resolve { resolver: "x".into(), reference: "r".into(), note: None }
            .is_resolution_receipt()
    );
    assert!(!SourceSpan::Time { t_start: 0.0, t_end: 1.0 }.is_resolution_receipt());
    assert!(
        !SourceSpan::Doc { page: Some(1), section: None, lines: None, label: None }
            .is_resolution_receipt()
    );
}

#[test]
fn flipping_a_node_to_confirmed_without_a_receipt_fails() {
    let mut bc = parse(&golden_json()).expect("golden parses");
    // n-login is claimed with only documentary receipts. Make it confirmed.
    let node = bc.graph.nodes.get_mut("n-login").expect("n-login exists");
    node.fidelity = Fidelity::Confirmed;
    let report = validate(&bc, None);
    assert!(!report.is_valid());
    assert!(
        report.errors.iter().any(|e| e.code == "fidelity"),
        "expected a fidelity violation, got {:?}",
        report.errors
    );
}

#[test]
fn unknown_source_id_in_a_receipt_fails() {
    let mut bc = parse(&golden_json()).expect("golden parses");
    let node = bc.graph.nodes.get_mut("n-dunning").expect("n-dunning exists");
    node.source_refs[0].source_id = "does-not-exist".into();
    let report = validate(&bc, None);
    assert!(!report.is_valid());
    assert!(report.errors.iter().any(|e| e.code == "receipt"));
}

#[test]
fn non_webapp_profile_skips_locator_gate() {
    // The locator gate is web-app-only; a corpus BC with an empty locator value
    // is not rejected by *that* gate (it has no Action payload anyway).
    let mut bc = parse(&golden_json()).expect("golden parses");
    bc.manifest.profile = "corpus".into();
    bc.manifest.app = None;
    let report = validate(&bc, None);
    assert!(
        !report.errors.iter().any(|e| e.code == "locator"),
        "corpus profile must not trigger locator gate"
    );
}
