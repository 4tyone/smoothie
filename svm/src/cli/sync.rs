use chrono::Utc;
use glob::glob;
use serde::Serialize;
use std::collections::HashSet;
use std::env;

use crate::error::Result;
use crate::index::schema::Node;
use crate::storage::{file as storage_file, git};

#[derive(Serialize)]
struct SyncOutput {
    added: usize,
    modified: usize,
    deleted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
}

impl std::fmt::Display for SyncOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Scanning corpus...")?;
        writeln!(f, "  + {} new files", self.added)?;
        writeln!(f, "  ~ {} modified files", self.modified)?;
        writeln!(f, "  - {} deleted files", self.deleted)?;
        writeln!(f)?;
        if let Some(ref commit) = self.commit {
            write!(f, "Changes applied. Committed: {}", commit)
        } else {
            write!(f, "Dry run complete. Run without --dry-run to apply.")
        }
    }
}

pub fn run(dry_run: bool, json: bool) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Get corpus root from index
    let corpus_root = index.manifest.corpus_root.clone();

    // Default pattern - in a real implementation, this would come from config
    let pattern = "**/*.md";
    let ignore_patterns = [".git", "node_modules", ".smoothie"];

    // Scan corpus for current files
    let glob_pattern = corpus_root.join(pattern);
    let glob_pattern_str = glob_pattern.to_string_lossy();

    let mut current_files: HashSet<String> = HashSet::new();
    for entry in glob(&glob_pattern_str)? {
        let path = entry?;

        if let Ok(rel_path) = path.strip_prefix(&corpus_root) {
            let rel_path_str = rel_path.to_string_lossy().to_string();

            let should_ignore = ignore_patterns.iter().any(|p| {
                rel_path_str.contains(p)
                    || rel_path
                        .components()
                        .any(|c| c.as_os_str().to_string_lossy() == *p)
            });

            if !should_ignore && path.is_file() {
                current_files.insert(rel_path_str);
            }
        }
    }

    // Get indexed files
    let indexed_files: HashSet<String> = index.nodes.keys().cloned().collect();

    // Calculate diff
    let added: Vec<String> = current_files.difference(&indexed_files).cloned().collect();
    let deleted: Vec<String> = indexed_files.difference(&current_files).cloned().collect();

    // For now, we don't track modifications (would need file hashes)
    let modified = 0;

    let output = SyncOutput {
        added: added.len(),
        modified,
        deleted: deleted.len(),
        commit: None,
    };

    if dry_run {
        if json {
            println!("{}", serde_json::to_string_pretty(&output)?);
        } else {
            println!("{}", output);
        }
        return Ok(());
    }

    // Apply changes
    for file in &added {
        index.nodes.insert(file.clone(), Node::default());
    }

    for file in &deleted {
        index.nodes.remove(file);
    }

    // Update manifest
    index.manifest.file_count = index.nodes.len();
    index.manifest.last_synced = Utc::now();
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("sync: +{} ~{} -{}", added.len(), modified, deleted.len());
    let commit_hash = git::git_commit(&smoothie_dir, &commit_msg)?;

    // Update manifest with commit hash
    index.manifest.version = commit_hash.clone();
    storage_file::write_index(&smoothie_dir, &index)?;

    let output = SyncOutput {
        added: added.len(),
        modified,
        deleted: deleted.len(),
        commit: Some(commit_hash),
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
