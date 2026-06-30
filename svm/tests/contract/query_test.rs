//! Contract tests for `svm query …` — the SVM's primary surface (spec 05).
//! An agent queries/traverses a hand-authored golden BC (no model) to answer and
//! reason over grounded, receipted data.

use assert_cmd::Command;
use serde_json::Value;
use std::path::PathBuf;

fn golden() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("schema/examples/bc.golden.json")
}

fn query(args: &[&str]) -> Value {
    let out = Command::cargo_bin("svm")
        .unwrap()
        .arg("query")
        .args(args)
        .arg("--bc")
        .arg(golden())
        .arg("--json")
        .output()
        .expect("run query");
    assert!(out.status.success(), "query failed: {}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).expect("query --json")
}

#[test]
fn node_resolves_facts_and_receipts() {
    let n = query(&["node", "n-retry-invoice"]);
    assert_eq!(n["id"], "n-retry-invoice");
    assert_eq!(n["fidelity"], "confirmed");
    assert!(n["has_action"].as_bool().unwrap());
    // Receipts resolve to real sources (provenance is grounded).
    let receipts = n["receipts"].as_array().unwrap();
    assert!(!receipts.is_empty());
    assert!(receipts.iter().all(|r| r["resolved"].as_bool().unwrap()));
    // Facts are resolved with their own receipts.
    assert!(!n["facts"].as_array().unwrap().is_empty());
}

#[test]
fn edges_follow_transitions() {
    let edges = query(&["edges", "n-login", "--kind", "transition", "--direction", "out"]);
    let arr = edges.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["to"], "n-retry-invoice");
    assert_eq!(arr[0]["fidelity"], "confirmed");
}

#[test]
fn view_lists_member_nodes() {
    let v = query(&["view", "v-billing"]);
    assert_eq!(v["fidelity"], "confirmed");
    let ids: Vec<&str> = v["nodes"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"n-retry-invoice"));
    assert_eq!(v["observation_count"], 1);
}

#[test]
fn outline_surfaces_scenes_and_gaps() {
    let o = query(&["outline", "o-dunning"]);
    let scenes = o["scenes"].as_array().unwrap();
    assert_eq!(scenes.len(), 2);
    // The retry scene surfaces the refund gap.
    let retry = scenes.iter().find(|s| s["scene_id"] == "s-retry").unwrap();
    let gaps = retry["gaps"].as_array().unwrap();
    assert_eq!(gaps.len(), 1);
    assert_eq!(gaps[0]["key"], "gap:refund-confirmation");
    assert_eq!(gaps[0]["kind"], "action");
}

#[test]
fn nodes_filter_by_fidelity() {
    let confirmed = query(&["nodes", "--fidelity", "confirmed"]);
    let ids: Vec<&str> = confirmed.as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["n-retry-invoice"]);
}

#[test]
fn gaps_are_surfaced_not_faked() {
    let gaps = query(&["gaps"]);
    let arr = gaps.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["key"], "gap:refund-confirmation");
}

#[test]
fn traverse_reaches_the_graph_deterministically() {
    let a = query(&["traverse", "n-login", "--depth", "3"]);
    let b = query(&["traverse", "n-login", "--depth", "3"]);
    assert_eq!(a, b, "traversal must be deterministic");
    let reached: Vec<&str> = a["reached"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert!(reached.contains(&"n-retry-invoice"));
    assert!(reached.contains(&"n-dunning"));
}

#[test]
fn unknown_node_errors_cleanly() {
    Command::cargo_bin("svm")
        .unwrap()
        .args(["query", "node", "does-not-exist", "--bc"])
        .arg(golden())
        .assert()
        .failure();
}
