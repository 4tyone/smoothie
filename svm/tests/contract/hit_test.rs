//! Contract tests for `smoothie hit` command (User Story 4)
//!
//! Tests verify:
//! - T038: New entry creation
//! - T039: Increment existing entry
//! - T040: Invalid reference format

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

/// Helper to create and initialize a test corpus
fn setup_initialized_corpus() -> TempDir {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();

    // Create markdown files
    fs::write(corpus.join("readme.md"), "# Readme\n\nTest content\n\nMore lines\n\nAnd more").unwrap();
    fs::write(corpus.join("guide.md"), "# Guide\n\nGuide content").unwrap();

    // Initialize the index
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(corpus);
    cmd.assert().success();

    temp
}

/// T038: Contract test for `smoothie hit` new entry
///
/// Given: An initialized index
/// When: Running `smoothie hit <ref> "<description>"` for the first time
/// Then: Creates new cache entry
/// And: Exit code is 0
#[test]
fn test_hit_new_entry() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:1-5")
        .arg("readme documentation")
        .current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Hit recorded").or(predicate::str::contains("readme.md")));
}

/// T038 (variant): Test hit with single line reference
#[test]
fn test_hit_single_line() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:1")
        .arg("first line")
        .current_dir(corpus);

    cmd.assert().success();
}

/// T038 (variant): Test hit JSON output
#[test]
fn test_hit_json_output() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:1-5")
        .arg("readme documentation")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["ref"], "readme.md:1-5");
    assert!(json["hits"].is_number());
    assert!(json["tier"].is_string());
}

/// T039: Contract test for `smoothie hit` increment existing
///
/// Given: An index with an existing cache entry
/// When: Running `smoothie hit` on the same reference
/// Then: Increments hit count
/// And: Exit code is 0
#[test]
fn test_hit_increment_existing() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // First hit
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("hit")
        .arg("readme.md:1-5")
        .arg("readme documentation")
        .arg("--json")
        .current_dir(corpus);
    let output1 = cmd1.assert().success().get_output().stdout.clone();
    let json1: serde_json::Value = serde_json::from_slice(&output1).unwrap();
    let hits1 = json1["hits"].as_u64().unwrap();

    // Second hit
    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("hit")
        .arg("readme.md:1-5")
        .arg("readme documentation")
        .arg("--json")
        .current_dir(corpus);
    let output2 = cmd2.assert().success().get_output().stdout.clone();
    let json2: serde_json::Value = serde_json::from_slice(&output2).unwrap();
    let hits2 = json2["hits"].as_u64().unwrap();

    assert_eq!(hits2, hits1 + 1, "Hit count should increment");
}

/// T039 (variant): Test hit with overlapping range (should merge)
#[test]
fn test_hit_overlapping_range() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // First hit: lines 1-5
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("hit")
        .arg("readme.md:1-5")
        .arg("first part")
        .current_dir(corpus);
    cmd1.assert().success();

    // Second hit: lines 3-7 (overlaps with 1-5)
    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("hit")
        .arg("readme.md:3-7")
        .arg("overlapping part")
        .current_dir(corpus);
    cmd2.assert().success();

    // Cache should show merged or separate entries depending on overlap threshold
}

/// T040: Contract test for `smoothie hit` invalid ref format
///
/// Given: An initialized index
/// When: Running `smoothie hit` with invalid line reference
/// Then: Exit code is 4 (invalid arguments)
#[test]
fn test_hit_invalid_ref_format() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Missing line number
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md")
        .arg("no line number")
        .current_dir(corpus);

    cmd.assert()
        .code(4)
        .stderr(predicate::str::contains("invalid").or(predicate::str::contains("format")));
}

/// T040 (variant): Test hit with negative line number
#[test]
fn test_hit_negative_line() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:-1")
        .arg("negative line")
        .current_dir(corpus);

    cmd.assert().code(4);
}

/// T040 (variant): Test hit with reversed range
#[test]
fn test_hit_reversed_range() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:10-5")
        .arg("reversed range")
        .current_dir(corpus);

    cmd.assert().code(4);
}

/// T040 (variant): Test hit with no index
#[test]
fn test_hit_no_index() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();
    fs::write(corpus.join("readme.md"), "# Test").unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:1")
        .arg("test")
        .current_dir(corpus);

    cmd.assert()
        .code(2)
        .stderr(predicate::str::contains("Index not found"));
}

/// T040 (variant): Test hit with malformed reference
#[test]
fn test_hit_malformed_ref() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("hit")
        .arg("readme.md:abc")
        .arg("non-numeric line")
        .current_dir(corpus);

    cmd.assert().code(4);
}
