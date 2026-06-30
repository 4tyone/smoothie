//! Loading a BC for consumption (spec 05 · determinism posture; 02).
//!
//! The SVM validates a BC **on read** — a shared BC is untrusted input (spec 06),
//! so the consumer never trusts the producer's word. Loading therefore always
//! runs the provenance-guarantee gates; an invalid BC is refused, never served.

use std::path::{Path, PathBuf};

use crate::bc::types::Bc;
use crate::bc::validate::{parse, validate};
use crate::error::{Result, SmoothieError};

/// The default BC filename inside a `.smoothie/` holding directory (spec 02).
pub const BC_FILENAME: &str = "bc.json";

/// A loaded, validated BC plus the directory it lives in (for companion paths).
pub struct LoadedBc {
    pub bc: Bc,
    /// The directory the `bc.json` sits in — companion paths resolve against it.
    /// (Public API for companion/emit resolution; not every caller reads it.)
    #[allow(dead_code)]
    pub dir: PathBuf,
}

/// Read + validate a BC at an explicit `bc.json` path. Refuses an invalid one.
pub fn load_bc(path: &Path) -> Result<LoadedBc> {
    let json = std::fs::read_to_string(path).map_err(|e| {
        SmoothieError::General(format!("cannot read BC at {}: {e}", path.display()))
    })?;
    let bc = parse(&json).map_err(|e| SmoothieError::General(format!("invalid BC: {e}")))?;
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let report = validate(&bc, Some(&dir));
    if !report.is_valid() {
        // Surface the first few violations; the SVM refuses to serve an invalid BC.
        let detail = report
            .errors
            .iter()
            .take(5)
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(SmoothieError::General(format!(
            "BC failed validation ({} violation(s)): {detail}",
            report.errors.len()
        )));
    }
    Ok(LoadedBc { bc, dir })
}

/// Resolve where the BC lives: an explicit path, or `.smoothie/bc.json` found by
/// walking up from `start` (the substrate's discovery convention).
pub fn resolve_bc_path(explicit: Option<&Path>, start: &Path) -> Result<PathBuf> {
    if let Some(p) = explicit {
        return Ok(p.to_path_buf());
    }
    let smoothie_dir = crate::storage::file::find_smoothie_dir(start)?;
    let candidate = smoothie_dir.join(BC_FILENAME);
    if candidate.exists() {
        Ok(candidate)
    } else {
        Err(SmoothieError::General(format!(
            "no BC found: pass --bc <path> or place one at {}",
            candidate.display()
        )))
    }
}

/// Open the BC for a command: explicit `--bc` path, else discover `.smoothie/bc.json`.
pub fn open(explicit: Option<&Path>) -> Result<LoadedBc> {
    let cwd = std::env::current_dir().map_err(SmoothieError::Io)?;
    let path = resolve_bc_path(explicit, &cwd)?;
    load_bc(&path)
}
