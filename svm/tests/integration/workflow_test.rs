//! Integration tests for full workflow (Phase 11)
//!
//! Tests verify:
//! - T087: Full workflow (init → write → node → hit → cache)

use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

/// T087: Integration test for full workflow
///
/// This test verifies the complete agent workflow:
/// 1. Initialize an index from a corpus
/// 2. Write enrichment metadata (summary, keywords, edges)
/// 3. Query node metadata
/// 4. Record content access (hit)
/// 5. View the cache
/// 6. Sync with corpus changes
/// 7. View history
/// 8. Rollback to previous state
#[test]
fn test_full_workflow() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();

    // Setup: Create test corpus
    fs::write(corpus.join("readme.md"), "# Readme\n\nProject documentation\n\nMore content here").unwrap();
    fs::write(corpus.join("api.md"), "# API\n\nAPI reference\n\nEndpoints listed below").unwrap();
    fs::write(corpus.join("guide.md"), "# Guide\n\nGetting started guide").unwrap();

    // Step 1: Initialize index
    let mut init_cmd = Command::cargo_bin("svm").unwrap();
    init_cmd.arg("init").arg(corpus);
    init_cmd
        .assert()
        .success()
        .stdout(predicate::str::contains("Initialized"))
        .stdout(predicate::str::contains("Found 3 files"));

    // Step 2: Write enrichment metadata
    // Write summary
    let mut summary_cmd = Command::cargo_bin("svm").unwrap();
    summary_cmd
        .arg("write")
        .arg("summary")
        .arg("readme.md")
        .arg("Main project documentation with overview")
        .current_dir(corpus);
    summary_cmd.assert().success();

    // Write keywords
    let mut keyword_cmd = Command::cargo_bin("svm").unwrap();
    keyword_cmd
        .arg("write")
        .arg("keyword")
        .arg("readme.md")
        .arg("documentation")
        .current_dir(corpus);
    keyword_cmd.assert().success();

    // Write TOC
    let mut toc_cmd = Command::cargo_bin("svm").unwrap();
    toc_cmd
        .arg("write")
        .arg("toc")
        .arg("readme.md")
        .arg("1:1:Readme\n2:3:Content")
        .current_dir(corpus);
    toc_cmd.assert().success();

    // Write edge
    let mut edge_cmd = Command::cargo_bin("svm").unwrap();
    edge_cmd
        .arg("write")
        .arg("edge")
        .arg("readme.md:3-5")
        .arg("api.md:1-3")
        .arg("references API docs")
        .current_dir(corpus);
    edge_cmd.assert().success();

    // Step 3: Query node metadata
    let mut node_cmd = Command::cargo_bin("svm").unwrap();
    node_cmd
        .arg("node")
        .arg("readme.md")
        .arg("--json")
        .current_dir(corpus);
    let output = node_cmd.assert().success().get_output().stdout.clone();
    let node_json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(node_json["summary"], "Main project documentation with overview");
    assert!(node_json["keywords"]
        .as_array()
        .unwrap()
        .contains(&serde_json::Value::String("documentation".to_string())));
    assert!(!node_json["toc"].as_array().unwrap().is_empty());
    assert!(!node_json["edges"].as_array().unwrap().is_empty());

    // Step 4: Record content access (hit)
    for _ in 0..5 {
        let mut hit_cmd = Command::cargo_bin("svm").unwrap();
        hit_cmd
            .arg("hit")
            .arg("readme.md:1-5")
            .arg("project overview")
            .current_dir(corpus);
        hit_cmd.assert().success();
    }

    // Step 5: View cache
    let mut cache_cmd = Command::cargo_bin("svm").unwrap();
    cache_cmd
        .arg("cache")
        .arg("--json")
        .current_dir(corpus);
    let cache_output = cache_cmd.assert().success().get_output().stdout.clone();
    let cache_json: serde_json::Value = serde_json::from_slice(&cache_output).unwrap();

    // Entry should be in trending or hot after 5 hits
    let total_entries: usize = cache_json["hot"].as_array().unwrap().len()
        + cache_json["trending"].as_array().unwrap().len();
    assert!(total_entries >= 1, "Cache should have at least one visible entry");

    // Step 6: Sync with corpus changes
    fs::write(corpus.join("new.md"), "# New File\n\nNew content added").unwrap();

    let mut sync_cmd = Command::cargo_bin("svm").unwrap();
    sync_cmd
        .arg("sync")
        .arg("--json")
        .current_dir(corpus);
    let sync_output = sync_cmd.assert().success().get_output().stdout.clone();
    let sync_json: serde_json::Value = serde_json::from_slice(&sync_output).unwrap();

    assert_eq!(sync_json["added"], 1, "Should detect 1 new file");

    // Verify new file is now in index
    let mut new_node_cmd = Command::cargo_bin("svm").unwrap();
    new_node_cmd.arg("node").arg("new.md").current_dir(corpus);
    new_node_cmd.assert().success();

    // Step 7: View history
    let mut history_cmd = Command::cargo_bin("svm").unwrap();
    history_cmd
        .arg("history")
        .arg("--json")
        .current_dir(corpus);
    let history_output = history_cmd.assert().success().get_output().stdout.clone();
    let history_json: serde_json::Value = serde_json::from_slice(&history_output).unwrap();

    let commits = history_json["commits"].as_array().unwrap();
    assert!(!commits.is_empty(), "Should have commits in history");

    // Step 8: Rollback (if we have enough history)
    if commits.len() >= 2 {
        let old_commit = commits[commits.len() - 1]["hash"].as_str().unwrap();

        // Dry-run first
        let mut rollback_dry_cmd = Command::cargo_bin("svm").unwrap();
        rollback_dry_cmd
            .arg("rollback")
            .arg(old_commit)
            .arg("--dry-run")
            .current_dir(corpus);
        rollback_dry_cmd.assert().success();
    }
}

/// T087 (variant): Test glossary and notes workflow
#[test]
fn test_glossary_notes_workflow() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path();

    // Setup
    fs::write(corpus.join("readme.md"), "# Readme\n\nContent").unwrap();
    fs::write(corpus.join("api.md"), "# API\n\nAPI docs").unwrap();

    // Initialize
    let mut init_cmd = Command::cargo_bin("svm").unwrap();
    init_cmd.arg("init").arg(corpus);
    init_cmd.assert().success();

    // Write glossary entry
    let mut glossary_write_cmd = Command::cargo_bin("svm").unwrap();
    glossary_write_cmd
        .arg("write")
        .arg("glossary")
        .arg("API")
        .arg("Application Programming Interface")
        .arg("--refs")
        .arg("api.md:1-3,readme.md:2")
        .current_dir(corpus);
    glossary_write_cmd.assert().success();

    // Write note
    let mut note_write_cmd = Command::cargo_bin("svm").unwrap();
    note_write_cmd
        .arg("write")
        .arg("note")
        .arg("architecture")
        .arg("Modular design pattern")
        .current_dir(corpus);
    note_write_cmd.assert().success();

    // Query glossary
    let mut glossary_cmd = Command::cargo_bin("svm").unwrap();
    glossary_cmd
        .arg("glossary")
        .arg("API")
        .arg("--json")
        .current_dir(corpus);
    let glossary_output = glossary_cmd.assert().success().get_output().stdout.clone();
    let glossary_json: serde_json::Value = serde_json::from_slice(&glossary_output).unwrap();

    assert_eq!(glossary_json["definition"], "Application Programming Interface");

    // Query notes
    let mut notes_cmd = Command::cargo_bin("svm").unwrap();
    notes_cmd
        .arg("notes")
        .arg("architecture")
        .arg("--json")
        .current_dir(corpus);
    let notes_output = notes_cmd.assert().success().get_output().stdout.clone();
    let notes_json: serde_json::Value = serde_json::from_slice(&notes_output).unwrap();

    assert_eq!(notes_json["value"], "Modular design pattern");
}

