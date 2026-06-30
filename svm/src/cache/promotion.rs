use crate::cache::tier::CacheTier;
use crate::index::schema::{Cache, CacheConfig};

impl Cache {
    /// Check and apply promotion rules after a hit
    pub fn apply_promotion_rules(&mut self, tier: CacheTier, index: usize, config: &CacheConfig) {
        match tier {
            CacheTier::Shadow => {
                // Check if entry should be promoted to trending
                if let Some(entry) = self.shadow.get(index)
                    && entry.hits >= config.promotion_threshold
                {
                    // Promote to trending
                    let entry = self.shadow.remove(index);

                    // Evict LRU from trending if full
                    while self.trending.len() >= config.trending_max {
                        if let Some(lru_idx) = self
                            .trending
                            .iter()
                            .enumerate()
                            .min_by_key(|(_, e)| e.last_hit)
                            .map(|(i, _)| i)
                        {
                            self.trending.remove(lru_idx);
                        }
                    }

                    self.trending.push(entry);
                }
            }
            CacheTier::Trending => {
                // Check if entry should be promoted to hot
                if let Some(entry) = self.trending.get(index) {
                    // Find the lowest hit count in hot tier
                    let lowest_hot_hits = self.hot.iter().map(|e| e.hits).min();

                    if let Some(lowest) = lowest_hot_hits {
                        if entry.hits > lowest {
                            // Swap with lowest hot entry
                            let entry = self.trending.remove(index);

                            // Find lowest hot entry index
                            if let Some((lru_idx, _)) =
                                self.hot.iter().enumerate().min_by_key(|(_, e)| e.hits)
                            {
                                let demoted = self.hot.remove(lru_idx);
                                self.hot.push(entry);
                                self.trending.push(demoted);
                            }
                        }
                    } else if self.hot.len() < config.hot_max {
                        // Hot tier not full, promote directly
                        let entry = self.trending.remove(index);
                        self.hot.push(entry);
                    }
                }
            }
            CacheTier::Hot => {
                // Already in hot tier, nothing to do
            }
        }
    }
}
