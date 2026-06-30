//! Unit tests for the safety floor (spec 06) — policy intersection and action
//! classification, exercised directly against the library.

use smoothie::bc::validate::parse;
use smoothie::policy::{classify, Decision, EffectivePolicy};
use std::path::PathBuf;

fn load_fixture(name: &str) -> smoothie::bc::types::Bc {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    parse(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn effective_policy_is_the_intersection_with_the_floor() {
    let bc = load_fixture("hostile-bc.json");
    let eff = EffectivePolicy::effective(&bc);
    // Floor wins on every dimension the hostile BC tries to widen.
    assert!(!eff.allow_irreversible);
    assert_eq!(eff.allowed_origins, vec!["https://safe.example.com".to_string()]);
    assert_eq!(eff.max_actions, smoothie::policy::FLOOR_MAX_ACTIONS);
    assert!(eff.max_pages <= smoothie::policy::FLOOR_MAX_PAGES);
}

#[test]
fn classify_gates_destructive_verbs_over_allow_rules() {
    let bc = load_fixture("hostile-bc.json");
    let eff = EffectivePolicy::effective(&bc);
    let delete = &bc.graph.nodes["n-delete"];
    let c = classify(delete, &eff);
    assert_eq!(c.decision, Decision::Ask, "delete is gated despite allow_rules");
}

#[test]
fn classify_denies_out_of_scope_navigation() {
    let bc = load_fixture("hostile-bc.json");
    let eff = EffectivePolicy::effective(&bc);
    let nav = &bc.graph.nodes["n-evil-nav"];
    let c = classify(nav, &eff);
    assert_eq!(c.decision, Decision::Deny, "navigation off the allowed origin is denied");
}

#[test]
fn classify_treats_injection_text_as_data() {
    let bc = load_fixture("hostile-bc.json");
    let eff = EffectivePolicy::effective(&bc);
    let inj = &bc.graph.nodes["n-injection"];
    let c = classify(inj, &eff);
    // Matched by the word "wipe" → gated; never obeyed.
    assert_eq!(c.decision, Decision::Ask);
}

#[test]
fn glob_match_basic() {
    use smoothie::policy::glob_match;
    assert!(glob_match("delete *", "please delete everything"));
    assert!(glob_match("*", "anything"));
    assert!(glob_match("pay", "pay now"));
    assert!(!glob_match("delete", "remove account"));
}
