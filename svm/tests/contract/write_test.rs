//! Contract tests for `smoothie write` subcommands (User Story 5)
//!
//! Tests verify:
//! - T049: write summary
//! - T050: write toc
//! - T051: write edge
//! - T052: write keyword
//! - T053: write glossary
//! - T054: write note

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

/// Helper to create and initialize a test corpus
fn setup_initialized_corpus() -> TempDir {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();

    // Create markdown files
    fs::write(corpus.join("readme.md"), "# Readme\n\nTest content\n\nMore lines").unwrap();
    fs::write(corpus.join("guide.md"), "# Guide\n\nGuide content").unwrap();
    fs::write(corpus.join("api.md"), "# API\n\nAPI documentation").unwrap();

    // Initialize the index
    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("init").arg(corpus);
    cmd.assert().success();

    temp
}

/// T049: Contract test for `smoothie write summary`
///
/// Given: An initialized index with a file
/// When: Running `smoothie write summary <file> "<summary>"`
/// Then: Updates the node's summary
/// And: Exit code is 0
#[test]
fn test_write_summary() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("summary")
        .arg("readme.md")
        .arg("This is the readme file with documentation")
        .current_dir(corpus);

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Summary written").or(predicate::str::contains("readme.md")));

    // Verify the summary was written
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(json["summary"], "This is the readme file with documentation");
}

/// T049 (variant): Test write summary to nonexistent file
#[test]
fn test_write_summary_file_not_found() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("summary")
        .arg("nonexistent.md")
        .arg("Some summary")
        .current_dir(corpus);

    cmd.assert()
        .code(3)
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("not in index")));
}

/// T050: Contract test for `smoothie write toc`
///
/// Given: An initialized index with a file
/// When: Running `smoothie write toc <file> "<toc>"`
/// Then: Updates the node's table of contents
/// And: Exit code is 0
#[test]
fn test_write_toc() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let toc = "1:1:Overview\n2:5:Getting Started\n2:10:Installation";

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("toc")
        .arg("readme.md")
        .arg(toc)
        .current_dir(corpus);

    cmd.assert().success();

    // Verify the TOC was written
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let toc_entries = json["toc"].as_array().unwrap();
    assert_eq!(toc_entries.len(), 3);
    assert_eq!(toc_entries[0]["title"], "Overview");
    assert_eq!(toc_entries[0]["depth"], 1);
    assert_eq!(toc_entries[0]["line"], 1);
}

/// T050 (variant): Test write toc with invalid format
#[test]
fn test_write_toc_invalid_format() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("toc")
        .arg("readme.md")
        .arg("invalid toc format")
        .current_dir(corpus);

    cmd.assert().code(4);
}

/// T051: Contract test for `smoothie write edge`
///
/// Given: An initialized index with files
/// When: Running `smoothie write edge <source> <target> "<relation>"`
/// Then: Creates an edge between the files
/// And: Exit code is 0
#[test]
fn test_write_edge() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("edge")
        .arg("readme.md:1-5")
        .arg("guide.md:1-3")
        .arg("references the guide")
        .current_dir(corpus);

    cmd.assert().success();

    // Verify the edge was written
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let edges = json["edges"].as_array().unwrap();
    assert!(!edges.is_empty());
    assert_eq!(edges[0]["target"], "guide.md:1-3");
    assert_eq!(edges[0]["relation"], "references the guide");
}

/// T051 (variant): Test write edge with invalid source reference
#[test]
fn test_write_edge_invalid_source() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("edge")
        .arg("readme.md")  // Missing line reference
        .arg("guide.md:1-3")
        .arg("bad source")
        .current_dir(corpus);

    cmd.assert().code(4);
}

/// T051 (variant): Test write edge with nonexistent target file
/// Note: The implementation allows edges to non-indexed files (for external references)
#[test]
fn test_write_edge_to_external_file() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("edge")
        .arg("readme.md:1-5")
        .arg("nonexistent.md:1-3")
        .arg("to external file")
        .current_dir(corpus);

    // Implementation allows edges to external files
    cmd.assert().success();
}

/// T052: Contract test for `smoothie write keyword`
///
/// Given: An initialized index with a file
/// When: Running `smoothie write keyword <file> "<keyword>"`
/// Then: Adds keyword to the node
/// And: Exit code is 0
#[test]
fn test_write_keyword() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("keyword")
        .arg("readme.md")
        .arg("documentation")
        .current_dir(corpus);

    cmd.assert().success();

    // Verify the keyword was added
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let keywords = json["keywords"].as_array().unwrap();
    assert!(keywords.contains(&serde_json::Value::String("documentation".to_string())));
}

/// T052 (variant): Test write keyword to nonexistent file
#[test]
fn test_write_keyword_file_not_found() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("keyword")
        .arg("nonexistent.md")
        .arg("keyword")
        .current_dir(corpus);

    cmd.assert().code(3);
}

/// T053: Contract test for `smoothie write glossary`
///
/// Given: An initialized index
/// When: Running `smoothie write glossary "<term>" "<definition>" --refs <refs>`
/// Then: Creates glossary entry
/// And: Exit code is 0
#[test]
fn test_write_glossary() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("glossary")
        .arg("API")
        .arg("Application Programming Interface")
        .arg("--refs")
        .arg("api.md:1-5,readme.md:2")
        .current_dir(corpus);

    cmd.assert().success();

    // Verify the glossary entry was created
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("glossary")
        .arg("API")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(json["definition"], "Application Programming Interface");
    assert!(json["refs"].as_array().unwrap().len() >= 1);
}

/// T053 (variant): Test write glossary with invalid reference
#[test]
fn test_write_glossary_invalid_ref() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("glossary")
        .arg("term")
        .arg("definition")
        .arg("--refs")
        .arg("invalid-ref")
        .current_dir(corpus);

    cmd.assert().code(4);
}

/// T054: Contract test for `smoothie write note`
///
/// Given: An initialized index
/// When: Running `smoothie write note "<key>" "<value>"`
/// Then: Creates a note entry
/// And: Exit code is 0
#[test]
fn test_write_note() {
    let temp = setup_initialized_corpus();
    let corpus = temp.path();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("note")
        .arg("architecture")
        .arg("The project uses a modular architecture")
        .current_dir(corpus);

    cmd.assert().success();

    // Verify the note was created
    let mut verify = Command::cargo_bin("svm").unwrap();
    verify
        .arg("notes")
        .arg("architecture")
        .arg("--json")
        .current_dir(corpus);
    let output = verify.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(json["value"], "The project uses a modular architecture");
}

/// T054 (variant): Test write note with no index
#[test]
fn test_write_note_no_index() {
    let temp = TempDir::new().unwrap();

    let mut cmd = Command::cargo_bin("svm").unwrap();
    cmd.arg("write")
        .arg("note")
        .arg("key")
        .arg("value")
        .current_dir(temp.path());

    cmd.assert().code(2);
}
