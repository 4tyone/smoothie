//! Contract tests for `smoothie history` and `smoothie rollback` commands (User Story 7)
//!
//! Tests verify:
//! - T071: history command
//! - T072: rollback success
//! - T073: rollback commit not found

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

    // Initialize the index
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(corpus);
    cmd.assert().success();

    temp
}

/// Helper to setup corpus with history
fn setup_corpus_with_history() -> TempDir {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Make several writes to create history
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("write")
        .arg("summary")
        .arg("readme.md")
        .arg("First summary")
        .current_dir(corpus);
    cmd1.assert().success();

    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("write")
        .arg("keyword")
        .arg("readme.md")
        .arg("documentation")
        .current_dir(corpus);
    cmd2.assert().success();

    let mut cmd3 = Command::cargo_bin("svm").unwrap();
    cmd3.arg("write")
        .arg("summary")
        .arg("readme.md")
        .arg("Updated summary")
        .current_dir(corpus);
    cmd3.assert().success();

    temp
}

/// T071: Contract test for `smoothie history`
///
/// Given: An index with enrichment history
/// When: Running `smoothie history`
/// Then: Lists recent commits
/// And: Exit code is 0
#[test]
fn test_history_shows_commits() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("history").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("write").or(predicate::str::contains("summary")));
}

/// T071 (variant): Test history JSON output
#[test]
fn test_history_json_output() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("history").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert!(json["commits"].is_array());
    let commits = json["commits"].as_array().unwrap();
    assert!(!commits.is_empty());

    // Check commit structure
    let commit = &commits[0];
    assert!(commit["hash"].is_string());
    assert!(commit["timestamp"].is_string());
    assert!(commit["message"].is_string());
}

/// T071 (variant): Test history with limit
#[test]
fn test_history_with_limit() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("history")
        .arg("-n")
        .arg("2")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    let commits = json["commits"].as_array().unwrap();
    assert!(commits.len() <= 2);
}

/// T071 (variant): Test history with no index
#[test]
fn test_history_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("history").current_dir(temp.path());

    cmd.assert().code(2);
}

/// T072: Contract test for `smoothie rollback` success
///
/// Given: An index with history
/// When: Running `smoothie rollback <commit>`
/// Then: Reverts to the specified commit
/// And: Exit code is 0
#[test]
fn test_rollback_success() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    // Get the commit hash from history
    let mut history_cmd = Command::cargo_bin("svm").unwrap();
    history_cmd
        .arg("history")
        .arg("--json")
        .current_dir(corpus);
    let output = history_cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let commits = json["commits"].as_array().unwrap();

    // Get an older commit (not the most recent)
    if commits.len() >= 2 {
        let old_commit = commits[1]["hash"].as_str().unwrap();

        let mut cmd = Command::cargo_bin("svm").unwrap();
        cmd.arg("rollback").arg(old_commit).current_dir(corpus);

        cmd.assert()
            .success()
            .stdout(predicate::str::contains("Rolled back").or(predicate::str::contains(old_commit)));
    }
}

/// T072 (variant): Test rollback JSON output
#[test]
fn test_rollback_json_output() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    // Get commit hash
    let mut history_cmd = Command::cargo_bin("svm").unwrap();
    history_cmd
        .arg("history")
        .arg("--json")
        .current_dir(corpus);
    let output = history_cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let commits = json["commits"].as_array().unwrap();

    if commits.len() >= 2 {
        let old_commit = commits[1]["hash"].as_str().unwrap();

        let mut cmd = Command::cargo_bin("svm").unwrap();
        cmd.arg("rollback")
            .arg(old_commit)
            .arg("--json")
            .current_dir(corpus);

        let output = cmd.assert().success().get_output().stdout.clone();
        let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

        assert_eq!(json["success"], true);
        assert!(json["reverted_to"].is_string());
        assert!(json["commit"].is_string());
    }
}

/// T072 (variant): Test rollback dry-run
#[test]
fn test_rollback_dry_run() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    // Get commit hash
    let mut history_cmd = Command::cargo_bin("svm").unwrap();
    history_cmd
        .arg("history")
        .arg("--json")
        .current_dir(corpus);
    let output = history_cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let commits = json["commits"].as_array().unwrap();

    if commits.len() >= 2 {
        let old_commit = commits[1]["hash"].as_str().unwrap();

        let mut cmd = Command::cargo_bin("svm").unwrap();
        cmd.arg("rollback")
            .arg(old_commit)
            .arg("--dry-run")
            .current_dir(corpus);

        cmd.assert().success();
    }
}

/// T073: Contract test for `smoothie rollback` commit not found
///
/// Given: An index with history
/// When: Running `smoothie rollback <nonexistent-commit>`
/// Then: Exit code is 3 (commit not found)
#[test]
fn test_rollback_commit_not_found() {
    let temp = setup_corpus_with_history();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("rollback")
        .arg("nonexistent123")
        .current_dir(corpus);

    cmd.assert()
        .code(3)
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("commit")));
}

/// T073 (variant): Test rollback with no index
#[test]
fn test_rollback_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("rollback").arg("abc123").current_dir(temp.path());

    cmd.assert().code(2);
}
