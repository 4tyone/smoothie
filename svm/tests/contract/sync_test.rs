//! Contract tests for `smoothie sync` command (User Story 6)
//!
//! Tests verify:
//! - T062: Sync with new files
//! - T063: Sync with deleted files
//! - T064: Sync dry-run mode

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

/// Helper to create and initialize a test corpus
fn setup_initialized_corpus() -> TempDir {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();

    // Create markdown files
    fs::write(corpus.join("readme.md"), "# Readme\n\nTest content").unwrap();
    fs::write(corpus.join("guide.md"), "# Guide\n\nGuide content").unwrap();

    // Initialize the index
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(corpus);
    cmd.assert().success();

    temp
}

/// T062: Contract test for `smoothie sync` with new files
///
/// Given: An initialized index
/// When: New files are added to the corpus and sync is run
/// Then: New files are added to the index
/// And: Exit code is 0
#[test]
fn test_sync_new_files() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Add a new file after init
    fs::write(corpus.join("new.md"), "# New\n\nNew content").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("new").or(predicate::str::contains("+")));

    // Verify the new file is in the index
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify.arg("node").arg("new.md").current_dir(corpus);
    verify.assert().success();
}

/// T062 (variant): Test sync JSON output with new files
#[test]
fn test_sync_new_files_json() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    fs::write(corpus.join("new1.md"), "# New 1").unwrap();
    fs::write(corpus.join("new2.md"), "# New 2").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["added"], 2);
}

/// T063: Contract test for `smoothie sync` with deleted files
///
/// Given: An initialized index with files
/// When: Files are deleted from the corpus and sync is run
/// Then: Deleted files are removed from the index
/// And: Exit code is 0
#[test]
fn test_sync_deleted_files() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Delete a file after init
    fs::remove_file(corpus.join("guide.md")).unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("deleted").or(predicate::str::contains("-")));

    // Verify the deleted file is no longer in the index
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify.arg("node").arg("guide.md").current_dir(corpus);
    verify.assert().code(3); // File not found
}

/// T063 (variant): Test sync JSON output with deleted files
#[test]
fn test_sync_deleted_files_json() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    fs::remove_file(corpus.join("guide.md")).unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["deleted"], 1);
}

/// T064: Contract test for `smoothie sync --dry-run`
///
/// Given: An initialized index with pending changes
/// When: Running `smoothie sync --dry-run`
/// Then: Shows changes without applying them
/// And: Exit code is 0
#[test]
fn test_sync_dry_run() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Add a new file
    fs::write(corpus.join("new.md"), "# New\n\nNew content").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").arg("--dry-run").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("dry").or(predicate::str::contains("Dry")));

    // Verify the file was NOT added to the index
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify.arg("node").arg("new.md").current_dir(corpus);
    verify.assert().code(3); // File not found - changes not applied
}

/// T064 (variant): Test sync dry-run JSON output
#[test]
fn test_sync_dry_run_json() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    fs::write(corpus.join("new.md"), "# New").unwrap();
    fs::remove_file(corpus.join("guide.md")).unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync")
        .arg("--dry-run")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["added"], 1);
    assert_eq!(json["deleted"], 1);
    // No commit should be present in dry run
    assert!(json["commit"].is_null() || !json.get("commit").is_some());
}

/// T062 (variant): Test sync with no changes
#[test]
fn test_sync_no_changes() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").current_dir(corpus);

    cmd.assert().success();
}

/// T062 (variant): Test sync with no index
#[test]
fn test_sync_no_index() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("readme.md"), "# Test").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").current_dir(temp.path());

    cmd.assert().code(2);
}

/// T062 (variant): Test sync with mixed changes (add, delete)
#[test]
fn test_sync_mixed_changes() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Add new files
    fs::write(corpus.join("new1.md"), "# New 1").unwrap();
    fs::write(corpus.join("new2.md"), "# New 2").unwrap();

    // Delete existing file
    fs::remove_file(corpus.join("guide.md")).unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("sync").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["added"], 2);
    assert_eq!(json["deleted"], 1);
}
