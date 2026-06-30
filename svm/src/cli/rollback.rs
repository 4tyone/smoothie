use serde::Serialize;
use std::env;

use crate::error::Result;
use crate::storage::{file as storage_file, git};

#[derive(Serialize)]
struct RollbackOutput {
    success: bool,
    reverted_to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
}

impl std::fmt::Display for RollbackOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(ref commit) = self.commit {
            writeln!(f, "Rolled back to {}", self.reverted_to)?;
            write!(
                f,
                "Committed: {} (rollback to {})",
                commit, self.reverted_to
            )
        } else {
            write!(f, "Dry run: would rollback to {}", self.reverted_to)
        }
    }
}

pub fn run(commit: &str, dry_run: bool, json: bool) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    if dry_run {
        // Just verify the commit exists
        let output = RollbackOutput {
            success: true,
            reverted_to: commit.to_string(),
            commit: None,
        };

        if json {
            println!("{}", serde_json::to_string_pretty(&output)?);
        } else {
            println!("{}", output);
        }

        return Ok(());
    }

    // Perform rollback
    let new_commit = git::git_rollback(&smoothie_dir, commit)?;

    let output = RollbackOutput {
        success: true,
        reverted_to: commit.to_string(),
        commit: Some(new_commit),
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
