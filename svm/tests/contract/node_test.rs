//! Contract tests for `smoothie node` command (User Story 2)
//!
//! Tests verify:
//! - T023: Success case - returns file metadata
//! - T024: File not found error
//! - T025: JSON output format

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

/// Helper to setup corpus with enriched node data
fn setup_enriched_corpus() -> TempDir {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Write summary
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("summary")
        .arg("readme.md")
        .arg("Test readme file with documentation")
        .current_dir(corpus);
    cmd.assert().success();

    // Write keywords
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("keyword")
        .arg("readme.md")
        .arg("documentation")
        .current_dir(corpus);
    cmd.assert().success();

    temp
}

/// T023: Contract test for `smoothie node` success case
///
/// Given: An initialized index with a file
/// When: Running `smoothie node <file>`
/// Then: Returns file metadata
/// And: Exit code is 0
#[test]
fn test_node_success_returns_metadata() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node").arg("readme.md").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("File: readme.md"))
        .stdout(predicate::str::contains("Summary:"))
        .stdout(predicate::str::contains("Access count:"));
}

/// T023 (variant): Test node with enriched data
#[test]
fn test_node_with_enriched_data() {
    let temp = setup_enriched_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node").arg("readme.md").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Test readme file with documentation"))
        .stdout(predicate::str::contains("documentation")); // keyword
}

/// T024: Contract test for `smoothie node` file not found
///
/// Given: An initialized index
/// When: Running `smoothie node <nonexistent-file>`
/// Then: Exit code is 3 (file not found)
#[test]
fn test_node_file_not_found() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node").arg("nonexistent.md").current_dir(corpus);

    cmd.assert()
        .code(3)
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("not in index")));
}

/// T024 (variant): Test node with no index
///
/// Given: A directory without .smoothie/
/// When: Running `smoothie node <file>`
/// Then: Exit code is 2 (index not found)
#[test]
fn test_node_no_index() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();
    fs::write(corpus.join("readme.md"), "# Test").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node").arg("readme.md").current_dir(corpus);

    cmd.assert()
        .code(2)
        .stderr(predicate::str::contains("Index not found"));
}

/// T025: Contract test for `smoothie node --json` output
///
/// Given: An initialized index with a file
/// When: Running `smoothie node <file> --json`
/// Then: Returns valid JSON with correct structure
/// And: Exit code is 0
#[test]
fn test_node_json_output() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    // Verify JSON structure per contract
    assert_eq!(json["file"], "readme.md");
    assert!(json["toc"].is_array());
    assert!(json["edges"].is_array());
    assert!(json["keywords"].is_array());
    assert!(json["access_count"].is_number());
}

/// T025 (variant): Test node JSON with enriched data
#[test]
fn test_node_json_with_enriched_data() {
    let temp = setup_enriched_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["summary"], "Test readme file with documentation");
    assert!(json["keywords"]
        .as_array()
        .unwrap()
        .contains(&serde_json::Value::String("documentation".to_string())));
}
