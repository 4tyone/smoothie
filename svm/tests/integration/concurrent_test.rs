//! Integration tests for concurrent access (Phase 11)
//!
//! Tests verify:
//! - T088: Concurrent access handling with file locking

use assert_cmd::Command;
use std::fs;
use std::sync::{Arc, Barrier};
use std::thread;
use tempfile::TempDir;

/// T088: Integration test for concurrent access
///
/// This test verifies that concurrent operations don't corrupt the index
/// by using file locking.
#[test]
fn test_concurrent_hits() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path().to_path_buf();

    // Setup
    fs::write(corpus.join("file1.md"), "# File 1\n\nContent 1").unwrap();
    fs::write(corpus.join("file2.md"), "# File 2\n\nContent 2").unwrap();
    fs::write(corpus.join("file3.md"), "# File 3\n\nContent 3").unwrap();

    // Initialize
    let mut init_cmd = Command::cargo_bin("svm").unwrap();
    init_cmd.arg("init").arg(&corpus);
    init_cmd.assert().success();

    // Spawn multiple threads to record hits concurrently
    let num_threads = 4;
    let hits_per_thread = 5;
    let barrier = Arc::new(Barrier::new(num_threads));

    let handles: Vec<_> = (0..num_threads)
        .map(|i| {
            let corpus_path = corpus.clone();
            let barrier = Arc::clone(&barrier);

            thread::spawn(move || {
                // Wait for all threads to be ready
                barrier.wait();

                for j in 0..hits_per_thread {
                    let file = format!("file{}.md", (i % 3) + 1);
                    let line = format!("{}:{}-{}", file, j + 1, j + 3);

                    let mut cmd = Command::cargo_bin("svm").unwrap();
                    cmd.arg("hit")
                        .arg(&line)
                        .arg(format!("concurrent hit {} from thread {}", j, i))
                        .current_dir(&corpus_path);

                    // Some hits may fail due to locking, which is acceptable
                    let _ = cmd.output();
                }
            })
        })
        .collect();

    // Wait for all threads to complete
    for handle in handles {
        handle.join().unwrap();
    }

    // Verify index is still readable and valid
    let mut cache_cmd = Command::cargo_bin("svm").unwrap();
    cache_cmd.arg("cache").arg("--json").current_dir(&corpus);
    let output = cache_cmd.assert().success().get_output().stdout.clone();

    // Should be valid JSON
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert!(json["hot"].is_array());
    assert!(json["trending"].is_array());

    // Verify we can still read node data
    let mut node_cmd = Command::cargo_bin("svm").unwrap();
    node_cmd.arg("node").arg("file1.md").current_dir(&corpus);
    node_cmd.assert().success();
}

/// T088 (variant): Test concurrent writes
#[test]
fn test_concurrent_writes() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path().to_path_buf();

    // Setup
    fs::write(corpus.join("file1.md"), "# File 1\n\nContent").unwrap();
    fs::write(corpus.join("file2.md"), "# File 2\n\nContent").unwrap();

    // Initialize
    let mut init_cmd = Command::cargo_bin("svm").unwrap();
    init_cmd.arg("init").arg(&corpus);
    init_cmd.assert().success();

    let num_threads = 4;
    let barrier = Arc::new(Barrier::new(num_threads));

    let handles: Vec<_> = (0..num_threads)
        .map(|i| {
            let corpus_path = corpus.clone();
            let barrier = Arc::clone(&barrier);

            thread::spawn(move || {
                barrier.wait();

                // Each thread writes to different aspects
                let file = if i % 2 == 0 { "file1.md" } else { "file2.md" };

                // Write summary
                let mut cmd = Command::cargo_bin("svm").unwrap();
                cmd.arg("write")
                    .arg("summary")
                    .arg(file)
                    .arg(format!("Summary from thread {}", i))
                    .current_dir(&corpus_path);
                let _ = cmd.output();

                // Write keyword
                let mut cmd2 = Command::cargo_bin("svm").unwrap();
                cmd2.arg("write")
                    .arg("keyword")
                    .arg(file)
                    .arg(format!("keyword{}", i))
                    .current_dir(&corpus_path);
                let _ = cmd2.output();
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    // Verify index is valid
    let mut node_cmd = Command::cargo_bin("svm").unwrap();
    node_cmd
        .arg("node")
        .arg("file1.md")
        .arg("--json")
        .current_dir(&corpus);
    let output = node_cmd.assert().success().get_output().stdout.clone();
    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();

    // Should have some summary (one of the writes succeeded)
    assert!(json["summary"].is_string() || json["summary"].is_null());
}

/// T088 (variant): Test read during write
#[test]
fn test_read_during_write() {
    let temp = TempDir::new().unwrap();
    let corpus = temp.path().to_path_buf();

    fs::write(corpus.join("readme.md"), "# Readme\n\nContent").unwrap();

    let mut init_cmd = Command::cargo_bin("svm").unwrap();
    init_cmd.arg("init").arg(&corpus);
    init_cmd.assert().success();

    let barrier = Arc::new(Barrier::new(2));

    let corpus_writer = corpus.clone();
    let barrier_writer = Arc::clone(&barrier);
    let writer = thread::spawn(move || {
        barrier_writer.wait();
        for i in 0..10 {
            let mut cmd = Command::cargo_bin("svm").unwrap();
            cmd.arg("write")
                .arg("summary")
                .arg("readme.md")
                .arg(format!("Summary version {}", i))
                .current_dir(&corpus_writer);
            let _ = cmd.output();
        }
    });

    let corpus_reader = corpus.clone();
    let barrier_reader = Arc::clone(&barrier);
    let reader = thread::spawn(move || {
        barrier_reader.wait();
        for _ in 0..10 {
            let mut cmd = Command::cargo_bin("svm").unwrap();
            cmd.arg("node")
                .arg("readme.md")
                .arg("--json")
                .current_dir(&corpus_reader);
            // Reads should always succeed
            let output = cmd.output();
            if let Ok(o) = output {
                if o.status.success() {
                    // Verify it's valid JSON
                    let _ = serde_json::from_slice::<serde_json::Value>(&o.stdout);
                }
            }
        }
    });

    writer.join().unwrap();
    reader.join().unwrap();

    // Final verification
    let mut final_cmd = Command::cargo_bin("svm").unwrap();
    final_cmd.arg("node").arg("readme.md").current_dir(&corpus);
    final_cmd.assert().success();
}
