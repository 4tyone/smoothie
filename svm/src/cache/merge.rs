use chrono::Utc;

use crate::index::schema::{CacheEntry, LineRef};

/// Merge two overlapping cache entries
pub fn merge_entries(
    existing: &CacheEntry,
    new_ref: &LineRef,
    new_description: &str,
) -> CacheEntry {
    // Merge ranges. `existing.reference` is read from an on-disk index that could
    // be corrupt or hand-edited — if it doesn't parse, don't panic: fall back to
    // the new ref alone rather than crashing the whole run.
    let merged_ref = match LineRef::parse(&existing.reference) {
        Ok(existing_ref) => existing_ref.merge_with(new_ref),
        Err(_) => new_ref.clone(),
    };

    // Keep the longer/more descriptive description
    let description = if new_description.len() > existing.description.len() {
        new_description.to_string()
    } else {
        existing.description.clone()
    };

    CacheEntry {
        reference: merged_ref.to_ref_string(),
        description,
        hits: existing.hits + 1, // Increment hits by 1, not sum
        last_hit: Utc::now(),
    }
}
