use std::path::Path;

use glob::glob;
use serde::Serialize;

use crate::error::{SmoothieError, Result};
use crate::index::schema::{Index, Node};
use crate::storage::{file as storage_file, git};

#[derive(Serialize)]
struct InitOutput {
    status: String,
    path: String,
    file_count: usize,
    skill_created: bool,
}

impl std::fmt::Display for InitOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Initialized Smoothie index at {}", self.path)?;
        writeln!(f, "  Found {} files", self.file_count)?;
        if self.skill_created {
            writeln!(f, "  Created SKILL.md")?;
        }
        writeln!(f)?;
        write!(f, "Run 'smoothie enrich' to start comprehensive enrichment.")
    }
}

pub fn run(corpus_path: &Path, pattern: &str, ignore: &str, json: bool) -> Result<()> {
    // Resolve the corpus path
    let corpus_path = corpus_path.canonicalize().map_err(|e| {
        SmoothieError::InvalidArgument(format!(
            "Cannot resolve path '{}': {}",
            corpus_path.display(),
            e
        ))
    })?;

    // Check if already initialized
    let smoothie_dir = corpus_path.join(".smoothie");
    if smoothie_dir.exists() {
        return Err(SmoothieError::General(format!(
            "Directory already initialized at {}",
            smoothie_dir.display()
        )));
    }

    // Parse ignore patterns
    let ignore_patterns: Vec<&str> = ignore.split(',').map(|s| s.trim()).collect();

    // Scan corpus for files matching pattern
    let glob_pattern = corpus_path.join(pattern);
    let glob_pattern_str = glob_pattern.to_string_lossy();

    let mut files: Vec<String> = Vec::new();
    for entry in glob(&glob_pattern_str)? {
        let path = entry?;

        // Convert to relative path
        let rel_path = path
            .strip_prefix(&corpus_path)
            .map_err(|_| SmoothieError::General("Failed to get relative path".to_string()))?;

        let rel_path_str = rel_path.to_string_lossy().to_string();

        // Check if path contains any ignore patterns
        let should_ignore = ignore_patterns.iter().any(|p| {
            rel_path_str.contains(p)
                || rel_path
                    .components()
                    .any(|c| c.as_os_str().to_string_lossy() == *p)
        });

        if !should_ignore && path.is_file() {
            files.push(rel_path_str);
        }
    }

    // Sort files for consistent ordering
    files.sort();

    // Create index
    let mut index = Index::new(corpus_path.clone(), files.len());

    // Add nodes for each file
    for file in &files {
        index.nodes.insert(file.clone(), Node::default());
    }

    // Create .smoothie directory
    let smoothie_dir = storage_file::create_smoothie_dir(&corpus_path)?;

    // Write index.json
    storage_file::write_index(&smoothie_dir, &index)?;

    // Create SKILL.md template
    let skill_path = smoothie_dir.join("SKILL.md");
    let skill_content = create_skill_template();
    std::fs::write(&skill_path, skill_content)?;

    // Initialize git and make initial commit
    git::git_init(&smoothie_dir)?;
    let commit_hash = git::git_commit(&smoothie_dir, "smoothie init")?;

    // Update manifest with commit hash
    let mut index = storage_file::read_index(&smoothie_dir)?;
    index.manifest.version = commit_hash;
    storage_file::write_index(&smoothie_dir, &index)?;

    // Output result
    let output = InitOutput {
        status: "initialized".to_string(),
        path: smoothie_dir.display().to_string(),
        file_count: files.len(),
        skill_created: true,
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}

fn create_skill_template() -> String {
    r#"# Smoothie Skill

This SKILL.md file provides guidance for AI agents working with this knowledge base.

## Quick Start

1. **Check cache first**: `smoothie cache`
2. **If hit found**: Read file section, then `smoothie hit <ref> "<description>"`
3. **If no hit**: Navigate with `smoothie node <file>`, read with cat
4. **After reading**: `smoothie hit <ref> "<description>"`
5. **Optionally enrich**: `smoothie write summary/toc/edge/glossary`

## Common Commands

| Command | Description |
|---------|-------------|
| `smoothie cache` | View hot-path cache |
| `smoothie node <file>` | Get file metadata |
| `smoothie hit <ref> "<desc>"` | Record content access |
| `smoothie write summary <file> "<text>"` | Write file summary |
| `smoothie glossary [term]` | View glossary |
| `smoothie sync` | Sync with corpus changes |

## Enrichment Guidelines

When you read and understand a file, consider adding:
- **Summary**: Brief description of file contents
- **TOC**: Table of contents with header hierarchy
- **Keywords**: Important terms in the file
- **Edges**: Relationships to other files
- **Glossary**: Domain-specific term definitions

Run `smoothie enrich` for comprehensive enrichment guidance.
"#
    .to_string()
}
