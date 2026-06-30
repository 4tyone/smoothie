pub mod merge;
pub mod promotion;
pub mod tier;

use crate::index::schema::{Cache, CacheEntry};

/// Read operations for cache
impl Cache {
    /// Get all visible cache entries (hot + trending)
    pub fn visible_entries(&self) -> Vec<&CacheEntry> {
        self.hot.iter().chain(self.trending.iter()).collect()
    }

    /// Get entry count across all tiers
    pub fn total_entries(&self) -> usize {
        self.hot.len() + self.trending.len() + self.shadow.len()
    }

    /// Check if cache is empty
    pub fn is_empty(&self) -> bool {
        self.hot.is_empty() && self.trending.is_empty() && self.shadow.is_empty()
    }
}
