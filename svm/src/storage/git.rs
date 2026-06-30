use std::path::Path;
use std::process::Command;

use crate::error::{SmoothieError, Result};

/// Initialize a git repository in the given directory
pub fn git_init(repo_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args(["init"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SmoothieError::Git(format!("git init failed: {}", stderr)));
    }

    Ok(())
}

/// Stage all files and create a commit
pub fn git_commit(repo_path: &Path, message: &str) -> Result<String> {
    // Stage all changes
    let add_output = Command::new("git")
        .args(["add", "."])
        .current_dir(repo_path)
        .output()?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(SmoothieError::Git(format!("git add failed: {}", stderr)));
    }

    // Check if there are changes to commit
    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output()?;

    if status_output.stdout.is_empty() {
        // Nothing to commit
        return get_current_commit_hash(repo_path);
    }

    // Commit
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(repo_path)
        .output()?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        // Check if it's just "nothing to commit"
        if stderr.contains("nothing to commit") {
            return get_current_commit_hash(repo_path);
        }
        return Err(SmoothieError::Git(format!("git commit failed: {}", stderr)));
    }

    get_current_commit_hash(repo_path)
}

/// Get the current commit hash (short form)
pub fn get_current_commit_hash(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // No commits yet
        return Ok(String::new());
    }

    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(hash)
}

/// Get git log history
pub fn git_history(repo_path: &Path, limit: usize) -> Result<Vec<GitCommit>> {
    let output = Command::new("git")
        .args(["log", &format!("-{}", limit), "--pretty=format:%h|%aI|%s"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // No commits yet is not an error
        if stderr.contains("does not have any commits") {
            return Ok(Vec::new());
        }
        return Err(SmoothieError::Git(format!("git log failed: {}", stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() == 3 {
                Some(GitCommit {
                    hash: parts[0].to_string(),
                    timestamp: parts[1].to_string(),
                    message: parts[2].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

/// Rollback by restoring a single tracked file from a specific commit.
/// Generalizes `git_rollback` off the markdown index onto any file (e.g. the
/// BC's `bc.json`), so the storage port can version a BC (spec 05).
pub fn git_rollback_file(repo_path: &Path, commit_hash: &str, file: &str) -> Result<()> {
    let verify_output = Command::new("git")
        .args(["cat-file", "-t", commit_hash])
        .current_dir(repo_path)
        .output()?;
    if !verify_output.status.success() {
        return Err(SmoothieError::CommitNotFound(commit_hash.to_string()));
    }

    let checkout_output = Command::new("git")
        .args(["checkout", commit_hash, "--", file])
        .current_dir(repo_path)
        .output()?;
    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        return Err(SmoothieError::Git(format!("git checkout failed: {}", stderr)));
    }
    Ok(())
}

/// Rollback to a specific commit by checking out index.json
pub fn git_rollback(repo_path: &Path, commit_hash: &str) -> Result<String> {
    // Verify commit exists
    let verify_output = Command::new("git")
        .args(["cat-file", "-t", commit_hash])
        .current_dir(repo_path)
        .output()?;

    if !verify_output.status.success() {
        return Err(SmoothieError::CommitNotFound(commit_hash.to_string()));
    }

    // Checkout index.json from that commit
    let checkout_output = Command::new("git")
        .args(["checkout", commit_hash, "--", "index.json"])
        .current_dir(repo_path)
        .output()?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        return Err(SmoothieError::Git(format!(
            "git checkout failed: {}",
            stderr
        )));
    }

    // Commit the rollback
    let message = format!("rollback to {}", commit_hash);
    git_commit(repo_path, &message)
}

/// Represents a git commit
#[derive(Debug, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub timestamp: String,
    pub message: String,
}
