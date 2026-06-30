use chrono::Utc;

use crate::index::schema::{CacheEntry, LineRef};

/// Merge two overlapping cache entries
pub fn merge_entries(
    existing: &CacheEntry,
    new_ref: &LineRef,
    new_description: &str,
) -> CacheEntry {
    // Parse existing reference
    let existing_ref = LineRef::parse(&existing.reference).unwrap();

    // Merge ranges
    let merged_ref = existing_ref.merge_with(new_ref);

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
