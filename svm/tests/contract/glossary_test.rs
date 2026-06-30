//! Contract tests for `smoothie glossary` and `smoothie notes` commands (User Story 8)
//!
//! Tests verify:
//! - T079: glossary all terms
//! - T080: glossary specific term
//! - T081: notes command

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
    fs::write(corpus.join("api.md"), "# API\n\nAPI documentation").unwrap();

    // Initialize the index
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(corpus);
    cmd.assert().success();

    temp
}

/// Helper to setup corpus with glossary entries
fn setup_corpus_with_glossary() -> TempDir {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Add glossary entries
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("write")
        .arg("glossary")
        .arg("API")
        .arg("Application Programming Interface")
        .arg("--refs")
        .arg("api.md:1-5")
        .current_dir(corpus);
    cmd1.assert().success();

    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("write")
        .arg("glossary")
        .arg("README")
        .arg("Documentation file")
        .arg("--refs")
        .arg("readme.md:1-3")
        .current_dir(corpus);
    cmd2.assert().success();

    temp
}

/// Helper to setup corpus with notes
fn setup_corpus_with_notes() -> TempDir {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    // Add notes
    let mut cmd1 = Command::cargo_bin("svm").unwrap();
    cmd1.arg("write")
        .arg("note")
        .arg("architecture")
        .arg("The project uses modular architecture")
        .current_dir(corpus);
    cmd1.assert().success();

    let mut cmd2 = Command::cargo_bin("svm").unwrap();
    cmd2.arg("write")
        .arg("note")
        .arg("conventions")
        .arg("Follow standard naming conventions")
        .current_dir(corpus);
    cmd2.assert().success();

    temp
}

/// T079: Contract test for `smoothie glossary` all terms
///
/// Given: An index with glossary entries
/// When: Running `smoothie glossary`
/// Then: Lists all glossary terms
/// And: Exit code is 0
#[test]
fn test_glossary_all_terms() {
    let temp = setup_corpus_with_glossary();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("API"))
        .stdout(predicate::str::contains("README"));
}

/// T079 (variant): Test glossary JSON output all terms
#[test]
fn test_glossary_all_terms_json() {
    let temp = setup_corpus_with_glossary();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    // Could be array of terms or object with terms
    assert!(json.is_object() || json.is_array());
}

/// T079 (variant): Test glossary with empty glossary
#[test]
fn test_glossary_empty() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary").current_dir(corpus);

    cmd.assert().success();
}

/// T080: Contract test for `smoothie glossary <term>` specific
///
/// Given: An index with glossary entries
/// When: Running `smoothie glossary <term>`
/// Then: Shows the term definition and references
/// And: Exit code is 0
#[test]
fn test_glossary_specific_term() {
    let temp = setup_corpus_with_glossary();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary").arg("API").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Application Programming Interface"))
        .stdout(predicate::str::contains("api.md"));
}

/// T080 (variant): Test glossary specific term JSON output
#[test]
fn test_glossary_specific_term_json() {
    let temp = setup_corpus_with_glossary();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary")
        .arg("API")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["definition"], "Application Programming Interface");
    assert!(json["refs"].is_array());
}

/// T080 (variant): Test glossary term not found
#[test]
fn test_glossary_term_not_found() {
    let temp = setup_corpus_with_glossary();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary")
        .arg("nonexistent")
        .current_dir(corpus);

    cmd.assert()
        .code(3)
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("Term")));
}

/// T080 (variant): Test glossary with no index
#[test]
fn test_glossary_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("glossary").current_dir(temp.path());

    cmd.assert().code(2);
}

/// T081: Contract test for `smoothie notes`
///
/// Given: An index with notes
/// When: Running `smoothie notes`
/// Then: Lists all notes
/// And: Exit code is 0
#[test]
fn test_notes_all() {
    let temp = setup_corpus_with_notes();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("architecture"))
        .stdout(predicate::str::contains("conventions"));
}

/// T081 (variant): Test notes JSON output
#[test]
fn test_notes_json() {
    let temp = setup_corpus_with_notes();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").arg("--json").current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert!(json.is_object() || json.is_array());
}

/// T081 (variant): Test notes specific key
#[test]
fn test_notes_specific_key() {
    let temp = setup_corpus_with_notes();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").arg("architecture").current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("modular architecture"));
}

/// T081 (variant): Test notes specific key JSON
#[test]
fn test_notes_specific_key_json() {
    let temp = setup_corpus_with_notes();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes")
        .arg("architecture")
        .arg("--json")
        .current_dir(corpus);

    let output = cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(json["value"], "The project uses modular architecture");
}

/// T081 (variant): Test notes key not found
#[test]
fn test_notes_key_not_found() {
    let temp = setup_corpus_with_notes();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").arg("nonexistent").current_dir(corpus);

    cmd.assert()
        .code(3)
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("key")));
}

/// T081 (variant): Test notes empty
#[test]
fn test_notes_empty() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").current_dir(corpus);

    cmd.assert().success();
}

/// T081 (variant): Test notes with no index
#[test]
fn test_notes_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("notes").current_dir(temp.path());

    cmd.assert().code(2);
}
