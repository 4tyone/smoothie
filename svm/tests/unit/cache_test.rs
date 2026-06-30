//! Unit tests for cache promotion logic (User Story 4)
//!
//! Tests verify:
//! - T041: Cache promotion logic (shadow → trending → hot)

use chrono::Utc;
use smoothie::cache::tier::CacheTier;
use smoothie::{Cache, CacheConfig, CacheEntry};

/// Helper to create a test cache entry
fn create_entry(reference: &str, hits: u64) -> CacheEntry {
    CacheEntry {
        reference: reference.to_string(),
        description: format!("Description for {}", reference),
        hits,
        last_hit: Utc::now(),
    }
}

/// T041: Test shadow to trending promotion at 3 hits
#[test]
fn test_promotion_shadow_to_trending() {
    let mut cache = Cache::default();
    let config = CacheConfig {
        promotion_threshold: 3,
        ..Default::default()
    };

    // Add entry to shadow with 3 hits (at threshold)
    let mut entry = create_entry("file.md:1-5", 3);
    cache.shadow.push(entry);

    // Apply promotion rules
    cache.apply_promotion_rules(CacheTier::Shadow, 0, &config);

    // Entry should be in trending, not shadow
    assert!(
        cache.shadow.iter().all(|e| e.reference != "file.md:1-5"),
        "Entry should be removed from shadow"
    );
    assert!(
        cache.trending.iter().any(|e| e.reference == "file.md:1-5"),
        "Entry should be in trending"
    );
}

/// T041: Test entry stays in shadow if below threshold
#[test]
fn test_no_promotion_below_threshold() {
    let mut cache = Cache::default();
    let config = CacheConfig {
        promotion_threshold: 3,
        ..Default::default()
    };

    // Add entry to shadow with 2 hits (below threshold)
    cache.shadow.push(create_entry("file.md:1-5", 2));

    // Apply promotion rules
    cache.apply_promotion_rules(CacheTier::Shadow, 0, &config);

    // Entry should still be in shadow
    assert!(
        cache.shadow.iter().any(|e| e.reference == "file.md:1-5"),
        "Entry should remain in shadow"
    );
    assert!(
        cache.trending.is_empty(),
        "Trending should be empty"
    );
}

/// T041: Test trending to hot promotion when entry has more hits than lowest hot
#[test]
fn test_promotion_trending_to_hot() {
    let mut cache = Cache::default();
    let config = CacheConfig {
        hot_max: 20,
        ..Default::default()
    };

    // Add entry to hot with 10 hits (the lowest)
    cache.hot.push(create_entry("hot.md:1-5", 10));

    // Add entry to trending with 15 hits (more than lowest hot)
    cache.trending.push(create_entry("trending.md:1-5", 15));

    cache.apply_promotion_rules(CacheTier::Trending, 0, &config);

    // Trending entry should now be in hot (swapped with lowest)
    assert!(
        cache.hot.iter().any(|e| e.reference == "trending.md:1-5"),
        "High-hit trending entry should be in hot"
    );
    assert!(
        cache.trending.iter().any(|e| e.reference == "hot.md:1-5"),
        "Demoted hot entry should be in trending"
    );
}

/// T041: Test trending promotes directly to hot if hot not full
#[test]
fn test_promotion_trending_to_empty_hot() {
    let mut cache = Cache::default();
    let config = CacheConfig {
        hot_max: 20,
        ..Default::default()
    };

    // Hot is empty, add entry to trending
    cache.trending.push(create_entry("trending.md:1-5", 5));

    cache.apply_promotion_rules(CacheTier::Trending, 0, &config);

    // Entry should be promoted to hot directly
    assert!(
        cache.hot.iter().any(|e| e.reference == "trending.md:1-5"),
        "Entry should be in hot"
    );
    assert!(
        cache.trending.is_empty(),
        "Trending should be empty"
    );
}

/// T041: Test new entry goes to shadow via add_to_shadow
#[test]
fn test_new_entry_to_shadow() {
    let mut cache = Cache::default();
    let config = CacheConfig::default();

    cache.add_to_shadow("new.md:1-5".to_string(), "new entry".to_string(), &config);

    assert!(
        cache.shadow.iter().any(|e| e.reference == "new.md:1-5"),
        "New entry should be in shadow"
    );
    assert_eq!(cache.shadow[0].hits, 1);
}

/// T041: Test shadow tier eviction when full
#[test]
fn test_shadow_eviction_when_full() {
    let mut cache = Cache::default();
    let config = CacheConfig {
        shadow_max: 3,
        ..Default::default()
    };

    // Fill shadow with entries
    for i in 0..3 {
        let mut entry = create_entry(&format!("file{}.md:1", i), 1);
        // Make older entries have earlier timestamps
        entry.last_hit = Utc::now() - chrono::Duration::hours(10 - i as i64);
        cache.shadow.push(entry);
    }

    // Add one more entry
    cache.add_to_shadow("new.md:1".to_string(), "new entry".to_string(), &config);

    // Shadow should still have max entries
    assert_eq!(cache.shadow.len(), 3, "Shadow should not exceed max");
    assert!(
        cache.shadow.iter().any(|e| e.reference == "new.md:1"),
        "New entry should be in shadow"
    );
}

/// T041: Test find_entry in different tiers
#[test]
fn test_find_entry() {
    let mut cache = Cache::default();

    cache.hot.push(create_entry("hot.md:1", 100));
    cache.trending.push(create_entry("trending.md:1", 10));
    cache.shadow.push(create_entry("shadow.md:1", 1));

    assert_eq!(
        cache.find_entry("hot.md:1"),
        Some((CacheTier::Hot, 0))
    );
    assert_eq!(
        cache.find_entry("trending.md:1"),
        Some((CacheTier::Trending, 0))
    );
    assert_eq!(
        cache.find_entry("shadow.md:1"),
        Some((CacheTier::Shadow, 0))
    );
    assert_eq!(
        cache.find_entry("nonexistent.md:1"),
        None
    );
}

/// T041: Test get_entry_mut updates entry
#[test]
fn test_get_entry_mut() {
    let mut cache = Cache::default();
    cache.shadow.push(create_entry("file.md:1-5", 1));

    if let Some(entry) = cache.get_entry_mut(CacheTier::Shadow, 0) {
        entry.hits += 1;
        entry.description = "updated description".to_string();
    }

    assert_eq!(cache.shadow[0].hits, 2);
    assert_eq!(cache.shadow[0].description, "updated description");
}
