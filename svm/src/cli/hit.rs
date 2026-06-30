use chrono::Utc;
use serde::Serialize;
use std::env;

use crate::cache::merge::merge_entries;
use crate::cache::tier::CacheTier;
use crate::error::Result;
use crate::index::schema::{CacheConfig, LineRef};
use crate::storage::{file as storage_file, git};

#[derive(Serialize)]
struct HitOutput {
    #[serde(rename = "ref")]
    reference: String,
    hits: u64,
    tier: String,
}

impl std::fmt::Display for HitOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Hit recorded: {} ({} total hits)",
            self.reference, self.hits
        )
    }
}

pub fn run(reference: &str, description: &str, json: bool) -> Result<()> {
    // Parse and validate line reference
    let line_ref = LineRef::parse(reference)?;

    // Find .smoothie directory
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    // Read index
    let mut index = storage_file::read_index(&smoothie_dir)?;

    // Get cache config (use defaults for now)
    let config = CacheConfig::default();

    // Check for overlapping entry
    let (hits, tier) = if let Some((tier, idx)) = index
        .cache
        .find_overlapping_entry(&line_ref, config.merge_threshold)
    {
        // Merge with existing entry
        let existing = match tier {
            CacheTier::Hot => &index.cache.hot[idx],
            CacheTier::Trending => &index.cache.trending[idx],
            CacheTier::Shadow => &index.cache.shadow[idx],
        };

        let merged = merge_entries(existing, &line_ref, description);
        let hits = merged.hits;

        // Replace the entry
        match tier {
            CacheTier::Hot => {
                index.cache.hot[idx] = merged;
            }
            CacheTier::Trending => {
                index.cache.trending[idx] = merged;
                // Check for promotion to hot
                index.cache.apply_promotion_rules(tier, idx, &config);
            }
            CacheTier::Shadow => {
                index.cache.shadow[idx] = merged;
                // Check for promotion to trending
                index.cache.apply_promotion_rules(tier, idx, &config);
            }
        }

        (hits, tier.to_string())
    } else {
        // Add new entry to shadow
        index
            .cache
            .add_to_shadow(line_ref.to_ref_string(), description.to_string(), &config);
        (1, "shadow".to_string())
    };

    // Update node access count if file exists in index
    if let Ok(node) = index.get_node_mut(&line_ref.file) {
        node.increment_access();
    }

    // Update manifest
    index.manifest.last_modified = Utc::now();

    // Write index
    storage_file::write_index(&smoothie_dir, &index)?;

    // Git commit
    let commit_msg = format!("hit: {}", reference);
    let commit_hash = git::git_commit(&smoothie_dir, &commit_msg)?;
    index.manifest.version = commit_hash;
    storage_file::write_index(&smoothie_dir, &index)?;

    // Output
    let output = HitOutput {
        reference: reference.to_string(),
        hits,
        tier,
    };

    if json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{}", output);
    }

    Ok(())
}
