use serde::Serialize;
use std::env;

use crate::error::Result;
use crate::storage::{file as storage_file, git};

#[derive(Serialize)]
struct HistoryOutput {
    commits: Vec<CommitEntry>,
}

#[derive(Serialize)]
struct CommitEntry {
    hash: String,
    timestamp: String,
    message: String,
}

impl std::fmt::Display for HistoryOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Enrichment history:")?;
        if self.commits.is_empty() {
            write!(f, "  (no history yet)")?;
        } else {
            for (i, commit) in self.commits.iter().enumerate() {
                if i == self.commits.len() - 1 {
                    write!(
                        f,
                        "  {}  {}  {}",
                        commit.hash, commit.timestamp, commit.message
                    )?;
                } else {
                    writeln!(
                        f,
                        "  {}  {}  {}",
                        commit.hash, commit.timestamp, commit.message
                    )?;
                }
            }
        }
        Ok(())
    }
}

pub fn run(limit: usize, json: bool) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let commits = git::git_history(&smoothie_dir, limit)?;

    let output = HistoryOutput {
        commits: commits
            .into_iter()
            .map(|c| CommitEntry {
                hash: c.hash,
                timestamp: c.timestamp,
                message: c.message,
            })
            .collect(),
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
