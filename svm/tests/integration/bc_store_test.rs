//! Integration test for the storage port (spec 05) — git history/rollback over a
//! versioned BC. Exercises `GitBcStore` directly (the OSS backend behind the port).

use smoothie::storage::port::{BcStore, GitBcStore};
use std::path::PathBuf;

/// A companion-free BC so a fresh store dir holding only `bc.json` validates.
fn source_bc() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/corpus-valid.json")
}

#[test]
fn init_load_commit_history_rollback() {
    let tmp = tempfile::tempdir().unwrap();
    let store_dir = tmp.path().join(".smoothie");

    // init: copy + validate + git init + first revision.
    let store = GitBcStore::init(&store_dir, &source_bc()).expect("init store");
    let loaded = store.load().expect("load valid BC");
    assert_eq!(loaded.bc.manifest.profile, "corpus");

    // Make a second revision by editing the BC and committing through the port.
    let bc_path = store_dir.join("bc.json");
    let mut text = std::fs::read_to_string(&bc_path).unwrap();
    text = text.replace("A topic", "A topic (v2)");
    std::fs::write(&bc_path, &text).unwrap();
    store.commit("edit node title").expect("commit v2");

    let history = store.history(10).expect("history");
    assert!(history.len() >= 2, "expected at least two revisions, got {}", history.len());

    // The edit is present now...
    assert!(std::fs::read_to_string(&bc_path).unwrap().contains("(v2)"));

    // ...roll back to the first (oldest) revision and the edit is gone.
    let first = history.last().unwrap().hash.clone();
    store.rollback(&first).expect("rollback");
    assert!(
        !std::fs::read_to_string(&bc_path).unwrap().contains("(v2)"),
        "rollback should restore the original BC"
    );

    // The rolled-back BC is still valid and loadable.
    store.load().expect("BC valid after rollback");
}

#[test]
fn init_refuses_an_invalid_bc() {
    let tmp = tempfile::tempdir().unwrap();
    let bad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/missing-receipt.json");
    let result = GitBcStore::init(tmp.path().join(".smoothie"), &bad);
    assert!(result.is_err(), "the store must refuse to version an invalid BC");
}
