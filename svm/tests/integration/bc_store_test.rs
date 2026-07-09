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

#[test]
fn init_inside_an_enclosing_git_repo_creates_its_own_store_repo() {
    // Regression: repo detection via HEAD resolves an *enclosing* repo, skipping
    // `git init` — so `svm: add bc.json` lands on the user's project history.
    // The store must always own `.smoothie/.git`.
    let tmp = tempfile::tempdir().unwrap();
    let run = |args: &[&str], cwd: &std::path::Path| {
        let out = std::process::Command::new("git").args(args).current_dir(cwd).output().unwrap();
        assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    // An enclosing project repo with one commit.
    run(&["init"], tmp.path());
    std::fs::write(tmp.path().join("README.md"), "project").unwrap();
    run(&["add", "."], tmp.path());
    run(&["commit", "-m", "project commit"], tmp.path());

    let store_dir = tmp.path().join(".smoothie");
    GitBcStore::init(&store_dir, &source_bc()).expect("init store inside a parent repo");

    assert!(store_dir.join(".git").exists(), "the store must own its own git repo");
    let parent_log = run(&["log", "--oneline"], tmp.path());
    assert_eq!(parent_log.lines().count(), 1, "the parent repo history must be untouched: {parent_log}");
    let store_log = run(&["log", "--oneline"], &store_dir);
    assert!(store_log.contains("svm: add bc.json"), "the BC revision lives in the store repo");
}

#[test]
fn init_copies_companions_and_cleans_up_on_failure() {
    // A BC whose receipts reference companion files must produce a self-contained,
    // valid store — and a failed init must not leave a half-created directory.
    let tmp = tempfile::tempdir().unwrap();
    let src_dir = tmp.path().join("src");
    std::fs::create_dir_all(src_dir.join("frames")).unwrap();
    std::fs::write(src_dir.join("frames/f1.txt"), "frame").unwrap();

    let mut bc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(source_bc()).unwrap()).unwrap();
    bc["sources"]["s1"]["companions"] =
        serde_json::json!([{ "kind": "frame", "path": "frames/f1.txt" }]);
    let src_bc = src_dir.join("bc.json");
    std::fs::write(&src_bc, serde_json::to_string_pretty(&bc).unwrap()).unwrap();

    let store_dir = tmp.path().join(".smoothie");
    let store = GitBcStore::init(&store_dir, &src_bc).expect("init copies companions");
    assert!(store_dir.join("frames/f1.txt").exists(), "companion copied into the store");
    store.load().expect("store with companions validates on its own");

    // Failure path: a BC referencing a companion that does not exist on disk.
    std::fs::remove_file(src_dir.join("frames/f1.txt")).unwrap();
    let store_dir2 = tmp.path().join(".smoothie2");
    assert!(GitBcStore::init(&store_dir2, &src_bc).is_err(), "missing companion refuses init");
    assert!(!store_dir2.exists(), "a failed init must not leave a half-created store");
}
