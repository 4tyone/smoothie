use chrono::Utc;
use std::env;

use crate::error::{SmoothieError, Result};
use crate::index::node::parse_toc;
use crate::index::schema::{Edge, GlossaryEntry, LineRef};
use crate::storage::{file as storage_file, git};

fn write_and_commit(message: &str) -> Result<String> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    // Git commit
    let commit_hash = git::git_commit(&smoothie_dir, message)?;

    // Update manifest version
    let mut index = storage_file::read_index(&smoothie_dir)?;
    index.manifest.version = commit_hash.clone();
    index.manifest.last_modified = Utc::now();
    storage_file::write_index(&smoothie_dir, &index)?;

    Ok(commit_hash)
}

pub fn run_summary(file: &str, summary: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Update node
    let node = index.get_node_mut(file)?;
    node.set_summary(summary.to_string());

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write summary: {}", file);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("Summary written: {}", file);
    println!("Committed: {}", commit_hash);

    Ok(())
}

pub fn run_toc(file: &str, toc: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Parse TOC
    let entries = parse_toc(toc)?;

    // Update node
    let node = index.get_node_mut(file)?;
    node.set_toc(entries);

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write toc: {}", file);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("TOC written: {}", file);
    println!("Committed: {}", commit_hash);

    Ok(())
}

pub fn run_edge(source_ref: &str, target_ref: &str, relation: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Parse references
    let source = LineRef::parse(source_ref)?;
    let _target = LineRef::parse(target_ref)?; // Validate target format

    // Check if source file exists
    if !index.has_file(&source.file) {
        return Err(SmoothieError::FileNotFound(source.file));
    }

    // Create edge
    let edge = Edge {
        target: target_ref.to_string(),
        source_lines: if source.start == source.end {
            source.start.to_string()
        } else {
            format!("{}-{}", source.start, source.end)
        },
        relation: relation.to_string(),
    };

    // Add edge to node
    let node = index.get_node_mut(&source.file)?;
    node.add_edge(edge);

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write edge: {} → {}", source.file, target_ref);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("Edge written: {} → {}", source_ref, target_ref);
    println!("Committed: {}", commit_hash);

    Ok(())
}

pub fn run_keyword(file: &str, keyword: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Update node
    let node = index.get_node_mut(file)?;
    node.add_keyword(keyword.to_string());

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write keyword: {} ({})", keyword, file);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("Keyword added: {} to {}", keyword, file);
    println!("Committed: {}", commit_hash);

    Ok(())
}

pub fn run_glossary(term: &str, definition: &str, refs: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Parse refs
    let ref_list: Vec<String> = refs
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // Validate refs
    for r in &ref_list {
        LineRef::parse(r)?;
    }

    // Create glossary entry
    let entry = GlossaryEntry {
        definition: Some(definition.to_string()),
        refs: ref_list,
    };

    // Add to index
    index.set_glossary_entry(term.to_string(), entry);

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write glossary: {}", term);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("Glossary entry written: {}", term);
    println!("Committed: {}", commit_hash);

    Ok(())
}

pub fn run_note(key: &str, value: &str) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Add note
    index.set_note(key.to_string(), value.to_string());

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Commit
    let commit_msg = format!("write note: {}", key);
    let commit_hash = write_and_commit(&commit_msg)?;

    println!("Note written: {}", key);
    println!("Committed: {}", commit_hash);

    Ok(())
}
