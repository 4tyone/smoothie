//! `svm bc …` — manage a versioned BC through the storage port (spec 05).
//!
//! `init` sets up a git-versioned `.smoothie/` store holding `bc.json`; `history`
//! and `rollback` time-travel it; `show` summarizes the current BC. The port
//! (`GitBcStore`) is the OSS backend; a hosted store can swap in later.

use std::path::Path;

use serde::Serialize;

use crate::bc::load;
use crate::error::{Result, SmoothieError};
use crate::storage::file::find_smoothie_dir;
use crate::storage::port::{BcStore, GitBcStore};

/// Resolve the store directory: explicit `--dir`, else discover `.smoothie/`.
fn store_dir(dir: Option<&Path>) -> Result<std::path::PathBuf> {
    match dir {
        Some(d) => Ok(d.to_path_buf()),
        None => {
            let cwd = std::env::current_dir().map_err(SmoothieError::Io)?;
            find_smoothie_dir(&cwd)
        }
    }
}

pub fn init(source_bc: &Path, dir: Option<&Path>, json: bool) -> Result<()> {
    let target = match dir {
        Some(d) => d.to_path_buf(),
        None => {
            // Default: a `.smoothie/` next to the source BC.
            let parent = source_bc.parent().unwrap_or_else(|| Path::new("."));
            parent.join(".smoothie")
        }
    };
    let store = GitBcStore::init(&target, source_bc)?;
    let head = store.history(1)?;
    let rev = head.first().map(|r| r.hash.clone()).unwrap_or_default();
    if json {
        #[derive(Serialize)]
        struct Out {
            store: String,
            revision: String,
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&Out {
                store: store.dir().display().to_string(),
                revision: rev,
            })
            .unwrap_or_default()
        );
    } else {
        println!("✓ initialized BC store at {}", store.dir().display());
        println!("  first revision: {rev}");
    }
    Ok(())
}

pub fn history(dir: Option<&Path>, limit: usize, json: bool) -> Result<()> {
    let store = GitBcStore::open(store_dir(dir)?);
    let revisions = store.history(limit)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&revisions).unwrap_or_default());
    } else if revisions.is_empty() {
        println!("(no revisions)");
    } else {
        for r in &revisions {
            println!("{}  {}  {}", r.hash, r.timestamp, r.message);
        }
    }
    Ok(())
}

pub fn rollback(revision: &str, dir: Option<&Path>, json: bool) -> Result<()> {
    let store = GitBcStore::open(store_dir(dir)?);
    let new_rev = store.rollback(revision)?;
    if json {
        #[derive(Serialize)]
        struct Out {
            rolled_back_to: String,
            new_revision: String,
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&Out {
                rolled_back_to: revision.to_string(),
                new_revision: new_rev,
            })
            .unwrap_or_default()
        );
    } else {
        println!("✓ rolled BC back to {revision} (new revision {new_rev})");
    }
    Ok(())
}

pub fn show(bc: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let m = &loaded.bc.manifest;
    if json {
        println!("{}", serde_json::to_string_pretty(&m).unwrap_or_default());
    } else {
        println!("BC {} (schema {})", m.bc_id, loaded.bc.schema);
        println!("  profile: {}", m.profile);
        if let Some(name) = m.app.as_ref().and_then(|a| a.name.as_ref()) {
            println!("  app: {name}");
        }
        if let Some(a) = &m.authorship {
            // Authorship/signature readable for the untrusted-shared-BC posture (spec 06).
            println!(
                "  authorship: {} / {} {}",
                a.author.as_deref().unwrap_or("?"),
                a.organization.as_deref().unwrap_or("?"),
                a.signature.as_deref().map(|s| format!("(signed: {s})")).unwrap_or_default()
            );
        }
        println!(
            "  counts: {} sources · {} facts · {} nodes · {} edges · {} views · {} outlines",
            m.counts.sources, m.counts.facts, m.counts.nodes, m.counts.edges, m.counts.views, m.counts.outlines
        );
    }
    Ok(())
}
