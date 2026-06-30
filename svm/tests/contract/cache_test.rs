//! Contract tests for `smoothie cache` command (User Story 3)
//!
//! Tests verify:
//! - T030: Cache with entries
//! - T031: Empty cache
//! - T032: JSON output format

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

/// Helper to setup corpus with cache entries
fn setup_corpus_with_cache() -> TempDir {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Record some hits to populate cache
    for _ in 0..5 {
        let mut cmd = Command::cargo_bin("svm").unwrap();
        cmd.arg("hit")
            .arg("readme.md:1-10")
            .arg("readme documentation")
            .current_dir(corpus);
        cmd.assert().success();
    }

    // Add more hits to another file
    for _ in 0..3 {
        let mut cmd = Command::cargo_bin("svm").unwrap();
        cmd.arg("hit")
            .arg("guide.md:1-5")
            .arg("guide overview")
            .current_dir(corpus);
        cmd.assert().success();
    }

    temp
}

/// T030: Contract test for `smoothie cache` with entries
///
/// Given: An index with cache entries
/// When: Running `smoothie cache`
/// Then: Displays hot and trending entries
/// And: Exit code is 0
#[test]
fn test_cache_with_entries() {
    let temp = setup_corpus_with_cache();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(
            predicate::str::contains("Hot")
                .or(predicate::str::contains("Trending"))
                .or(predicate::str::contains("readme.md")),
        );
}

/// T031: Contract test for `smoothie cache` empty case
///
/// Given: An initialized index with no hits
/// When: Running `smoothie cache`
/// Then: Shows empty cache message
/// And: Exit code is 0
#[test]
fn test_cache_empty() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").current_dir(corpus);

    cmd.assert().success().stdout(
        predicate::str::contains("Hot")
            .or(predicate::str::contains("empty"))
            .or(predicate::str::contains("none")),
    );
}

/// T031 (variant): Test cache with no index
///
/// Given: A directory without .smoothie/
/// When: Running `smoothie cache`
/// Then: Exit code is 2 (index not found)
#[test]
fn test_cache_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").current_dir(temp.path());

    cmd.assert()
        .code(2)
        .stderr(predicate::str::contains("Index not found"));
}

/// T032: Contract test for `smoothie cache --json` output
///
/// Given: An index with cache entries
/// When: Running `smoothie cache --json`
/// Then: Returns valid JSON with hot and trending arrays
/// And: Exit code is 0
#[test]
fn test_cache_json_output() {
    let temp = setup_corpus_with_cache();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    // Verify JSON structure per contract
    assert!(json["hot"].is_array());
    assert!(json["trending"].is_array());

    // Check entry structure if there are entries
    let hot = json["hot"].as_array().unwrap();
    let trending = json["trending"].as_array().unwrap();

    if !hot.is_empty() || !trending.is_empty() {
        let entries: Vec<_> = hot.iter().chain(trending.iter()).collect();
        if let Some(entry) = entries.first() {
            assert!(entry["ref"].is_string());
            assert!(entry["description"].is_string());
            assert!(entry["hits"].is_number());
            assert!(entry["last_hit"].is_string());
        }
    }
}

/// T032 (variant): Test cache JSON with empty cache
#[test]
fn test_cache_json_empty() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert!(json["hot"].as_array().unwrap().is_empty());
    assert!(json["trending"].as_array().unwrap().is_empty());
}

/// T030 (variant): Test cache with limit option
#[test]
fn test_cache_with_limit() {
    let temp = setup_corpus_with_cache();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("cache").arg("-n").arg("1").current_dir(corpus);

    cmd.assert().success();
    // Just verify command succeeds with limit option
}
