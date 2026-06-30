//! Contract tests for `smoothie init` command (User Story 1)
//!
//! Tests verify:
//! - T014: Success case - creates index from corpus
//! - T015: Glob pattern filtering
//! - T016: Already-initialized directory handling

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

/// Helper to create a test corpus with markdown files
fn create_test_corpus(dir: &TempDir) -> std::path::PathBuf {
    let corpus = dir.path().join("corpus");
    fs::create_dir_all(&corpus).unwrap();

    // Create some markdown files
    fs::write(corpus.join("readme.md"), "# Readme\n\nTest content").unwrap();
    fs::write(corpus.join("guide.md"), "# Guide\n\nGuide content").unwrap();

    // Create a subdirectory with more files
    let subdir = corpus.join("docs");
    fs::create_dir_all(&subdir).unwrap();
    fs::write(subdir.join("api.md"), "# API\n\nAPI docs").unwrap();
    fs::write(subdir.join("notes.txt"), "Some notes").unwrap();

    corpus
}

/// T014: Contract test for `smoothie init` success case
///
/// Given: A directory with markdown files
/// When: Running `smoothie init <path>`
/// Then: Creates .smoothie/index.json with nodes for each file
/// And: Exit code is 0
#[test]
fn test_init_success_creates_index() {
    let temp = TempDir::new().unwrap();
    let corpus = create_test_corpus(&temp);

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(&corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Initialized Smoothie index"))
        .stdout(predicate::str::contains("Found 3 files")); // readme.md, guide.md, docs/api.md

    // Verify .smoothie directory was created
    let smoothie_dir = corpus.join(".smoothie");
    assert!(smoothie_dir.exists(), ".smoothie directory should exist");

    // Verify index.json was created
    let index_path = smoothie_dir.join("index.json");
    assert!(index_path.exists(), "index.json should exist");

    // Verify index content
    let index_content = fs::read_to_string(&index_path).unwrap();
    let index: serde_json::Value = serde_json::from_str(&index_content).unwrap();

    // Check manifest
    assert!(index["manifest"].is_object());
    assert_eq!(index["manifest"]["file_count"], 3);

    // Check nodes exist for each file
    assert!(index["nodes"]["readme.md"].is_object());
    assert!(index["nodes"]["guide.md"].is_object());
    assert!(index["nodes"]["docs/api.md"].is_object());
}

/// T014 (JSON output variant): Contract test for `smoothie init --json`
#[test]
fn test_init_success_json_output() {
    let temp = TempDir::new().unwrap();
    let corpus = create_test_corpus(&temp);

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(&corpus).arg("--json");

    let output = cmd.assert().success().get_output().stdout.clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(json["status"], "initialized");
    assert_eq!(json["file_count"], 3);
    assert!(json["path"].as_str().unwrap().contains(".smoothie"));
}

/// T015: Contract test for `smoothie init` with glob pattern
///
/// Given: A directory with mixed file types
/// When: Running `smoothie init <path> --pattern "**/*.txt"`
/// Then: Only indexes files matching the pattern
#[test]
fn test_init_with_glob_pattern() {
    let temp = TempDir::new().unwrap();
    let corpus = create_test_corpus(&temp);

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init")
        .arg(&corpus)
        .arg("--pattern")
        .arg("**/*.txt");

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Found 1 files")); // Only notes.txt

    // Verify only .txt files are indexed
    let index_path = corpus.join(".smoothie/index.json");
    let index_content = fs::read_to_string(&index_path).unwrap();
    let index: serde_json::Value = serde_json::from_str(&index_content).unwrap();

    assert_eq!(index["manifest"]["file_count"], 1);
    assert!(index["nodes"]["docs/notes.txt"].is_object());
    assert!(index["nodes"]["readme.md"].is_null());
}

/// T016: Contract test for `smoothie init` on already-initialized directory
///
/// Given: A directory that already has .smoothie/
/// When: Running `smoothie init <path>`
/// Then: Returns error (already initialized)
/// And: Exit code is 1
#[test]
fn test_init_already_initialized() {
    let temp = TempDir::new().unwrap();
    let corpus = create_test_corpus(&temp);

    // First init
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("init").arg(&corpus);
    cmd1.assert().success();

    // Second init should fail (already initialized)
    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("init").arg(&corpus);

    cmd2.assert()
        .code(1)
        .stderr(predicate::str::contains("already initialized"));
}

/// T016 (variant): Test init with invalid path
///
/// Given: A non-existent path
/// When: Running `smoothie init <path>`
/// Then: Exit code is 4 (invalid arguments)
#[test]
fn test_init_invalid_path() {
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg("/nonexistent/path/to/corpus");

    cmd.assert()
        .code(4)
        .stderr(predicate::str::contains("No such file").or(predicate::str::contains("does not exist")));
}

/// T016 (variant): Test init with empty directory
///
/// Given: An empty directory
/// When: Running `smoothie init <path>`
/// Then: Creates empty index
/// And: Exit code is 0
#[test]
fn test_init_empty_directory() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path().join("empty");
    fs::create_dir_all(&corpus).unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(&corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Found 0 files"));

    // Verify empty index was created
    let index_path = corpus.join(".smoothie/index.json");
    let index_content = fs::read_to_string(&index_path).unwrap();
    let index: serde_json::Value = serde_json::from_str(&index_content).unwrap();

    assert_eq!(index["manifest"]["file_count"], 0);
}
