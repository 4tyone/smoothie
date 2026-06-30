use serde::Serialize;
use std::env;

use crate::error::Result;
use crate::index::schema::{Edge, TocEntry};
use crate::storage::file as storage_file;

#[derive(Serialize)]
struct NodeOutput {
    file: String,
    summary: Option<String>,
    toc: Vec<TocEntry>,
    edges: Vec<Edge>,
    keywords: Vec<String>,
    access_count: u64,
}

impl std::fmt::Display for NodeOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "File: {}", self.file)?;
        writeln!(
            f,
            "Summary: {}",
            self.summary.as_deref().unwrap_or("(not set)")
        )?;
        writeln!(f)?;

        // TOC
        if self.toc.is_empty() {
            writeln!(f, "TOC: (empty)")?;
        } else {
            writeln!(f, "TOC:")?;
            for entry in &self.toc {
                let indent = "  ".repeat(entry.depth as usize);
                let prefix = "#".repeat(entry.depth as usize);
                writeln!(
                    f,
                    "  {}{} {} (line {})",
                    indent, prefix, entry.title, entry.line
                )?;
            }
        }

        // Edges
        if self.edges.is_empty() {
            writeln!(f, "Edges: (none)")?;
        } else {
            writeln!(f, "Edges:")?;
            for edge in &self.edges {
                writeln!(
                    f,
                    "  :{} → {} [{}]",
                    edge.source_lines, edge.target, edge.relation
                )?;
            }
        }

        // Keywords
        if self.keywords.is_empty() {
            writeln!(f, "Keywords: (none)")?;
        } else {
            writeln!(f, "Keywords: {}", self.keywords.join(", "))?;
        }

        write!(f, "Access count: {}", self.access_count)
    }
}

pub fn run(file: &str, json: bool) -> Result<()> {
    // Find .smoothie directory
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    // Read index
    let index = storage_file::read_index(&smoothie_dir)?;

    // Get node
    let node = index.get_node(file)?;

    let output = NodeOutput {
        file: file.to_string(),
        summary: node.summary.clone(),
        toc: node.toc.clone(),
        edges: node.edges.clone(),
        keywords: node.keywords.clone(),
        access_count: node.access_count,
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
