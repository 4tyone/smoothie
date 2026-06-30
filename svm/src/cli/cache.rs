use serde::Serialize;
use std::env;

use crate::error::Result;
use crate::index::schema::CacheEntry;
use crate::storage::file as storage_file;

#[derive(Serialize)]
struct CacheOutput {
    hot: Vec<CacheEntry>,
    trending: Vec<CacheEntry>,
}

impl std::fmt::Display for CacheOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Hot content:")?;
        if self.hot.is_empty() {
            writeln!(f, "  (none yet)")?;
        } else {
            for (i, entry) in self.hot.iter().enumerate() {
                writeln!(
                    f,
                    "  {}. {}    \"{}\"    {} hits",
                    i + 1,
                    entry.reference,
                    entry.description,
                    entry.hits
                )?;
            }
        }

        writeln!(f)?;
        writeln!(f, "Trending:")?;
        if self.trending.is_empty() {
            write!(f, "  (none yet)")?;
        } else {
            for (i, entry) in self.trending.iter().enumerate() {
                if i == self.trending.len() - 1 {
                    write!(
                        f,
                        "  {}. {}    \"{}\"    {} hits",
                        i + 1,
                        entry.reference,
                        entry.description,
                        entry.hits
                    )?;
                } else {
                    writeln!(
                        f,
                        "  {}. {}    \"{}\"    {} hits",
                        i + 1,
                        entry.reference,
                        entry.description,
                        entry.hits
                    )?;
                }
            }
        }

        Ok(())
    }
}

pub fn run(limit: usize, json: bool) -> Result<()> {
    // Find .smoothie directory
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    // Read index
    let index = storage_file::read_index(&smoothie_dir)?;

    // Get cache entries up to limit
    let hot: Vec<CacheEntry> = index.cache.hot.iter().take(limit).cloned().collect();
    let trending: Vec<CacheEntry> = index.cache.trending.iter().take(limit).cloned().collect();

    let output = CacheOutput { hot, trending };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
