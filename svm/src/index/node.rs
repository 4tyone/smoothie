use crate::error::{SmoothieError, Result};
use crate::index::schema::{Edge, Index, Node, TocEntry};

impl Index {
    /// Get a node by file path
    pub fn get_node(&self, file_path: &str) -> Result<&Node> {
        self.nodes
            .get(file_path)
            .ok_or_else(|| SmoothieError::FileNotFound(file_path.to_string()))
    }

    /// Get a mutable node by file path
    pub fn get_node_mut(&mut self, file_path: &str) -> Result<&mut Node> {
        self.nodes
            .get_mut(file_path)
            .ok_or_else(|| SmoothieError::FileNotFound(file_path.to_string()))
    }

    /// Check if a file exists in the index
    pub fn has_file(&self, file_path: &str) -> bool {
        self.nodes.contains_key(file_path)
    }
}

impl Node {
    /// Update the summary
    pub fn set_summary(&mut self, summary: String) {
        self.summary = Some(summary);
    }

    /// Add a keyword if not already present
    pub fn add_keyword(&mut self, keyword: String) {
        if !self.keywords.contains(&keyword) {
            self.keywords.push(keyword);
        }
    }

    /// Add an edge
    pub fn add_edge(&mut self, edge: Edge) {
        self.edges.push(edge);
    }

    /// Set TOC entries
    pub fn set_toc(&mut self, entries: Vec<TocEntry>) {
        self.toc = entries;
    }

    /// Increment access count
    pub fn increment_access(&mut self) {
        self.access_count += 1;
    }
}

/// Parse TOC from string format: "depth:line:title" per line
pub fn parse_toc(input: &str) -> Result<Vec<TocEntry>> {
    let mut entries = Vec::new();

    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() != 3 {
            return Err(SmoothieError::InvalidTocFormat(format!(
                "Expected format 'depth:line:title', got '{}'",
                line
            )));
        }

        let depth: u8 = parts[0].parse().map_err(|_| {
            SmoothieError::InvalidTocFormat(format!("Invalid depth '{}' in '{}'", parts[0], line))
        })?;

        if !(1..=6).contains(&depth) {
            return Err(SmoothieError::InvalidTocFormat(format!(
                "Depth must be 1-6, got {} in '{}'",
                depth, line
            )));
        }

        let line_num: u32 = parts[1].parse().map_err(|_| {
            SmoothieError::InvalidTocFormat(format!(
                "Invalid line number '{}' in '{}'",
                parts[1], line
            ))
        })?;

        if line_num == 0 {
            return Err(SmoothieError::InvalidTocFormat(
                "Line number must be positive".to_string(),
            ));
        }

        let title = parts[2].to_string();

        entries.push(TocEntry {
            depth,
            title,
            line: line_num,
        });
    }

    Ok(entries)
}
