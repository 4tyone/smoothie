use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::{SmoothieError, Result};

/// The complete metadata index stored in .smoothie/index.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    /// Metadata about the index itself
    pub manifest: Manifest,

    /// Map of file path (relative to corpus root) to node metadata
    pub nodes: HashMap<String, Node>,

    /// Map of term to glossary entry
    pub glossary: HashMap<String, GlossaryEntry>,

    /// Key-value store for navigation hints and observations
    pub notes: HashMap<String, String>,

    /// Three-tier cache for frequently accessed content
    pub cache: Cache,
}

impl Index {
    /// Create a new empty index
    pub fn new(corpus_root: PathBuf, file_count: usize) -> Self {
        let now = Utc::now();
        Self {
            manifest: Manifest {
                version: String::new(),
                corpus_root,
                file_count,
                last_synced: now,
                last_modified: now,
            },
            nodes: HashMap::new(),
            glossary: HashMap::new(),
            notes: HashMap::new(),
            cache: Cache::default(),
        }
    }
}

/// Metadata about the index itself
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Git commit hash of last modification
    pub version: String,

    /// Absolute path to corpus directory
    pub corpus_root: PathBuf,

    /// Number of files in corpus
    pub file_count: usize,

    /// ISO 8601 timestamp of last `smoothie sync`
    pub last_synced: DateTime<Utc>,

    /// ISO 8601 timestamp of last write operation
    pub last_modified: DateTime<Utc>,
}

/// Metadata for a single file in the corpus
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Node {
    /// Brief description of file contents (null if not enriched)
    pub summary: Option<String>,

    /// Table of contents (headers within the file)
    pub toc: Vec<TocEntry>,

    /// Relationships to other files
    pub edges: Vec<Edge>,

    /// Important terms in this file
    pub keywords: Vec<String>,

    /// Times accessed with `smoothie hit`
    pub access_count: u64,
}

/// A header entry in a file's table of contents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TocEntry {
    /// Header level (1 = #, 2 = ##, etc.)
    pub depth: u8,

    /// Header text
    pub title: String,

    /// Line number (1-indexed)
    pub line: u32,
}

/// A directed relationship between file sections
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    /// Target file with line reference: `file.md:line` or `file.md:start-end`
    pub target: String,

    /// Lines in source file: `line` or `start-end`
    pub source_lines: String,

    /// Description of the relationship
    pub relation: String,
}

/// A domain term with definition and references
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    /// Definition of the term (optional)
    pub definition: Option<String>,

    /// File:line references where term appears
    pub refs: Vec<String>,
}

/// Three-tier cache for frequently accessed content
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Cache {
    /// Established high-value content (visible)
    pub hot: Vec<CacheEntry>,

    /// Rising popularity, candidates for hot (visible)
    pub trending: Vec<CacheEntry>,

    /// Proving value, needs 3 hits to promote (hidden)
    pub shadow: Vec<CacheEntry>,
}

/// A cached content reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    /// File with line reference: `file.md:line` or `file.md:start-end`
    #[serde(rename = "ref")]
    pub reference: String,

    /// Description of what this content is about
    pub description: String,

    /// Access count
    pub hits: u64,

    /// ISO 8601 timestamp of last access
    pub last_hit: DateTime<Utc>,
}

/// Parsed line reference for validation and operations
#[derive(Debug, Clone, PartialEq)]
pub struct LineRef {
    /// File path relative to corpus root
    pub file: String,

    /// Start line (1-indexed)
    pub start: u32,

    /// End line (1-indexed, same as start for single line)
    pub end: u32,
}

impl LineRef {
    /// Parse from string format: "file.md:line" or "file.md:start-end"
    pub fn parse(s: &str) -> Result<Self> {
        // Find the last colon to split file path from line reference
        let colon_idx = s.rfind(':').ok_or_else(|| {
            SmoothieError::InvalidLineRef(format!(
                "Missing colon separator in '{}'. Expected format: file.md:line or file.md:start-end",
                s
            ))
        })?;

        let file = s[..colon_idx].to_string();
        let line_part = &s[colon_idx + 1..];

        if file.is_empty() {
            return Err(SmoothieError::InvalidLineRef(
                "File path cannot be empty".to_string(),
            ));
        }

        // Parse line or range
        let (start, end) = if let Some(dash_idx) = line_part.find('-') {
            let start_str = &line_part[..dash_idx];
            let end_str = &line_part[dash_idx + 1..];

            let start: u32 = start_str.parse().map_err(|_| {
                SmoothieError::InvalidLineRef(format!(
                    "Invalid start line number '{}' in '{}'",
                    start_str, s
                ))
            })?;

            let end: u32 = end_str.parse().map_err(|_| {
                SmoothieError::InvalidLineRef(format!(
                    "Invalid end line number '{}' in '{}'",
                    end_str, s
                ))
            })?;

            (start, end)
        } else {
            let line: u32 = line_part.parse().map_err(|_| {
                SmoothieError::InvalidLineRef(format!(
                    "Invalid line number '{}' in '{}'",
                    line_part, s
                ))
            })?;
            (line, line)
        };

        // Validate
        if start == 0 {
            return Err(SmoothieError::InvalidLineRef(
                "Line number must be positive (1-indexed)".to_string(),
            ));
        }

        if end < start {
            return Err(SmoothieError::InvalidLineRef(format!(
                "End line ({}) must be >= start line ({})",
                end, start
            )));
        }

        Ok(Self { file, start, end })
    }

    /// Convert back to string format
    pub fn to_ref_string(&self) -> String {
        if self.start == self.end {
            format!("{}:{}", self.file, self.start)
        } else {
            format!("{}:{}-{}", self.file, self.start, self.end)
        }
    }

    /// Get the size of this reference (number of lines)
    pub fn size(&self) -> u32 {
        self.end - self.start + 1
    }

    /// Calculate overlap percentage with another LineRef
    /// Returns 0.0 if different files
    pub fn overlap_with(&self, other: &LineRef) -> f64 {
        if self.file != other.file {
            return 0.0;
        }

        let overlap_start = self.start.max(other.start);
        let overlap_end = self.end.min(other.end);

        if overlap_start > overlap_end {
            return 0.0;
        }

        let overlap_size = (overlap_end - overlap_start + 1) as f64;
        let min_size = self.size().min(other.size()) as f64;

        overlap_size / min_size
    }

    /// Merge two overlapping LineRefs
    /// Panics if files are different
    pub fn merge_with(&self, other: &LineRef) -> Self {
        assert_eq!(
            self.file, other.file,
            "Cannot merge LineRefs from different files"
        );

        Self {
            file: self.file.clone(),
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }
}

impl std::fmt::Display for LineRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_ref_string())
    }
}

/// Configuration from .smoothie/config.toml
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub general: GeneralConfig,
    pub cache: CacheConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    /// Path to corpus root (default: ".")
    pub corpus_root: PathBuf,

    /// Glob pattern for files to index (default: "**/*.md")
    pub file_pattern: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            corpus_root: PathBuf::from("."),
            file_pattern: "**/*.md".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheConfig {
    /// Max entries in hot tier (default: 20)
    pub hot_max: usize,

    /// Max entries in trending tier (default: 30)
    pub trending_max: usize,

    /// Max entries in shadow tier (default: 100)
    pub shadow_max: usize,

    /// Hits needed to promote shadow → trending (default: 3)
    pub promotion_threshold: u64,

    /// Overlap percentage to trigger merge (default: 0.5)
    pub merge_threshold: f64,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            hot_max: 20,
            trending_max: 30,
            shadow_max: 100,
            promotion_threshold: 3,
            merge_threshold: 0.5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_line_ref_parse_single_line() {
        let lr = LineRef::parse("file.md:42").unwrap();
        assert_eq!(lr.file, "file.md");
        assert_eq!(lr.start, 42);
        assert_eq!(lr.end, 42);
    }

    #[test]
    fn test_line_ref_parse_range() {
        let lr = LineRef::parse("path/to/file.md:15-48").unwrap();
        assert_eq!(lr.file, "path/to/file.md");
        assert_eq!(lr.start, 15);
        assert_eq!(lr.end, 48);
    }

    #[test]
    fn test_line_ref_invalid_no_colon() {
        assert!(LineRef::parse("file.md").is_err());
    }

    #[test]
    fn test_line_ref_invalid_zero_line() {
        assert!(LineRef::parse("file.md:0").is_err());
    }

    #[test]
    fn test_line_ref_invalid_end_less_than_start() {
        assert!(LineRef::parse("file.md:48-15").is_err());
    }

    #[test]
    fn test_line_ref_overlap_same_file() {
        let a = LineRef::parse("file.md:10-20").unwrap();
        let b = LineRef::parse("file.md:15-25").unwrap();
        // Overlap is 15-20 = 6 lines, min size is 11, so 6/11 ≈ 0.545
        let overlap = a.overlap_with(&b);
        assert!(overlap > 0.5 && overlap < 0.6);
    }

    #[test]
    fn test_line_ref_overlap_different_files() {
        let a = LineRef::parse("file1.md:10-20").unwrap();
        let b = LineRef::parse("file2.md:10-20").unwrap();
        assert_eq!(a.overlap_with(&b), 0.0);
    }

    #[test]
    fn test_line_ref_merge() {
        let a = LineRef::parse("file.md:10-20").unwrap();
        let b = LineRef::parse("file.md:15-25").unwrap();
        let merged = a.merge_with(&b);
        assert_eq!(merged.file, "file.md");
        assert_eq!(merged.start, 10);
        assert_eq!(merged.end, 25);
    }
}
