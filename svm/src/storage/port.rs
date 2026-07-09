//! The **storage port** (spec 05 · "Storage is a port"; 09).
//!
//! The substrate's git-versioned local files are the OSS backend behind one
//! interface, so the hosted multi-tenant store can swap in later without touching
//! the BC contract or the SVM's determinism. Phase 1 ships the `GitBcStore`
//! backend; a `HostedBcStore` can implement the same trait in a later edition.

use std::path::{Path, PathBuf};

use crate::bc::load::{load_bc, LoadedBc, BC_FILENAME};
use crate::error::{Result, SmoothieError};
use crate::storage::git;

/// One revision in a BC's history.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Revision {
    pub hash: String,
    pub timestamp: String,
    pub message: String,
}

/// A versioned home for a BC. Implementations must keep the BC auditable and
/// time-travelable (spec 05 · git versioning) — load validates on read, every
/// `commit` is a revision, and `rollback` restores a prior revision in place.
// `load`/`commit` are port API exercised by tests and future backends; the `svm`
// binary reaches them indirectly, so allow them to look unused in that crate.
#[allow(dead_code)]
pub trait BcStore {
    /// Load + validate the current BC (refuses an invalid one).
    fn load(&self) -> Result<LoadedBc>;
    /// Persist the current on-disk state as a new revision; returns its id.
    fn commit(&self, message: &str) -> Result<String>;
    /// Most-recent revisions, newest first.
    fn history(&self, limit: usize) -> Result<Vec<Revision>>;
    /// Restore the BC to a prior revision (recorded as a new revision).
    fn rollback(&self, revision: &str) -> Result<String>;
    /// The directory holding the BC (companions resolve against it).
    fn dir(&self) -> &Path;
}

/// The OSS backend: a `.smoothie/` directory holding `bc.json` (+ companions),
/// versioned with git. This is the substrate's storage, generalized off the
/// markdown index onto the BC.
pub struct GitBcStore {
    dir: PathBuf,
}

impl GitBcStore {
    /// Wrap an existing `.smoothie/` directory that already contains `bc.json`.
    pub fn open(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Create a `.smoothie/` store at `dir`, copy `source_bc` (and its
    /// companions) into it, validate it, `git init`, and make the first revision.
    pub fn init(dir: impl Into<PathBuf>, source_bc: &Path) -> Result<Self> {
        let dir = dir.into();
        let created = !dir.exists();
        match Self::init_inner(&dir, source_bc) {
            Ok(()) => Ok(Self { dir }),
            Err(e) => {
                // Never leave a half-created store behind (only if we made it).
                if created {
                    let _ = std::fs::remove_dir_all(&dir);
                }
                Err(e)
            }
        }
    }

    fn init_inner(dir: &Path, source_bc: &Path) -> Result<()> {
        // Validate the source in place first — never version an invalid BC.
        // Companion paths resolve against the source's own directory here.
        let loaded = load_bc(source_bc)?;
        let src_dir = source_bc.parent().unwrap_or(Path::new("."));

        std::fs::create_dir_all(dir)?;
        let dest = dir.join(BC_FILENAME);
        std::fs::copy(source_bc, &dest).map_err(|e| {
            SmoothieError::General(format!(
                "cannot copy BC {} -> {}: {e}",
                source_bc.display(),
                dest.display()
            ))
        })?;

        // Copy companions so the store is self-contained and still validates
        // (receipts must resolve against the store dir, spec 02).
        for source in loaded.bc.sources.values() {
            for comp in &source.companions {
                let rel = Path::new(&comp.path);
                if rel.is_absolute()
                    || rel.components().any(|c| matches!(c, std::path::Component::ParentDir))
                {
                    return Err(SmoothieError::General(format!(
                        "companion path {:?} escapes the BC directory — refusing to init",
                        comp.path
                    )));
                }
                let to = dir.join(rel);
                if let Some(parent) = to.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(src_dir.join(rel), &to).map_err(|e| {
                    SmoothieError::General(format!(
                        "cannot copy companion {:?} into the store: {e}",
                        comp.path
                    ))
                })?;
            }
        }

        // Re-validate at the destination — the store must stand on its own.
        load_bc(&dest)?;

        // The store's repo must live in `dir` itself. Checking HEAD would resolve
        // an *enclosing* repo and skip init — landing revisions on the user's
        // project history — so check for `dir/.git` directly.
        if !dir.join(".git").exists() {
            git::git_init(dir)?;
        }
        git::git_commit(dir, "svm: add bc.json")?;
        Ok(())
    }

    fn bc_path(&self) -> PathBuf {
        self.dir.join(BC_FILENAME)
    }
}

impl BcStore for GitBcStore {
    fn load(&self) -> Result<LoadedBc> {
        load_bc(&self.bc_path())
    }

    fn commit(&self, message: &str) -> Result<String> {
        git::git_commit(&self.dir, message)
    }

    fn history(&self, limit: usize) -> Result<Vec<Revision>> {
        Ok(git::git_history(&self.dir, limit)?
            .into_iter()
            .map(|c| Revision {
                hash: c.hash,
                timestamp: c.timestamp,
                message: c.message,
            })
            .collect())
    }

    fn rollback(&self, revision: &str) -> Result<String> {
        // Restore bc.json from the target revision, then record the rollback.
        git::git_rollback_file(&self.dir, revision, BC_FILENAME)?;
        // Re-validate after restore — refuse to leave an invalid BC in place.
        load_bc(&self.bc_path())?;
        git::git_commit(&self.dir, &format!("svm: rollback bc.json to {revision}"))
    }

    fn dir(&self) -> &Path {
        &self.dir
    }
}
