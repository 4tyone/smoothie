use chrono::Utc;

use crate::index::schema::{Cache, CacheConfig, CacheEntry, LineRef};

impl Cache {
    /// Find an entry by reference in any tier
    pub fn find_entry(&self, reference: &str) -> Option<(CacheTier, usize)> {
        for (i, entry) in self.hot.iter().enumerate() {
            if entry.reference == reference {
                return Some((CacheTier::Hot, i));
            }
        }
        for (i, entry) in self.trending.iter().enumerate() {
            if entry.reference == reference {
                return Some((CacheTier::Trending, i));
            }
        }
        for (i, entry) in self.shadow.iter().enumerate() {
            if entry.reference == reference {
                return Some((CacheTier::Shadow, i));
            }
        }
        None
    }

    /// Find an entry that overlaps with the given reference
    pub fn find_overlapping_entry(
        &self,
        line_ref: &LineRef,
        merge_threshold: f64,
    ) -> Option<(CacheTier, usize)> {
        // Check all tiers for overlapping entries
        for (i, entry) in self.hot.iter().enumerate() {
            if let Ok(entry_ref) = LineRef::parse(&entry.reference)
                && line_ref.overlap_with(&entry_ref) >= merge_threshold
            {
                return Some((CacheTier::Hot, i));
            }
        }
        for (i, entry) in self.trending.iter().enumerate() {
            if let Ok(entry_ref) = LineRef::parse(&entry.reference)
                && line_ref.overlap_with(&entry_ref) >= merge_threshold
            {
                return Some((CacheTier::Trending, i));
            }
        }
        for (i, entry) in self.shadow.iter().enumerate() {
            if let Ok(entry_ref) = LineRef::parse(&entry.reference)
                && line_ref.overlap_with(&entry_ref) >= merge_threshold
            {
                return Some((CacheTier::Shadow, i));
            }
        }
        None
    }

    /// Add a new entry to the shadow tier
    pub fn add_to_shadow(&mut self, reference: String, description: String, config: &CacheConfig) {
        let entry = CacheEntry {
            reference,
            description,
            hits: 1,
            last_hit: Utc::now(),
        };

        self.shadow.push(entry);

        // Enforce max size by removing oldest entries
        while self.shadow.len() > config.shadow_max {
            // Remove the oldest (by last_hit)
            if let Some(oldest_idx) = self
                .shadow
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| e.last_hit)
                .map(|(i, _)| i)
            {
                self.shadow.remove(oldest_idx);
            }
        }
    }

    /// Get mutable reference to entry by tier and index
    pub fn get_entry_mut(&mut self, tier: CacheTier, index: usize) -> Option<&mut CacheEntry> {
        match tier {
            CacheTier::Hot => self.hot.get_mut(index),
            CacheTier::Trending => self.trending.get_mut(index),
            CacheTier::Shadow => self.shadow.get_mut(index),
        }
    }

    /// Remove entry from a tier
    pub fn remove_entry(&mut self, tier: CacheTier, index: usize) -> Option<CacheEntry> {
        match tier {
            CacheTier::Hot => {
                if index < self.hot.len() {
                    Some(self.hot.remove(index))
                } else {
                    None
                }
            }
            CacheTier::Trending => {
                if index < self.trending.len() {
                    Some(self.trending.remove(index))
                } else {
                    None
                }
            }
            CacheTier::Shadow => {
                if index < self.shadow.len() {
                    Some(self.shadow.remove(index))
                } else {
                    None
                }
            }
        }
    }
}

/// Cache tier enum
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheTier {
    Hot,
    Trending,
    Shadow,
}

impl std::fmt::Display for CacheTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CacheTier::Hot => write!(f, "hot"),
            CacheTier::Trending => write!(f, "trending"),
            CacheTier::Shadow => write!(f, "shadow"),
        }
    }
}
