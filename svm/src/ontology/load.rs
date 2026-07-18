//! Loading an `ontology.json` for consumption (spec 01/06). The SVM validates on
//! read — a shared ontology is untrusted input (spec 06) — so loading always runs
//! gates G1-G7; an invalid ontology is refused, never served.

use std::path::{Path, PathBuf};

use crate::error::{Result, SmoothieError};
use crate::ontology::types::Ontology;
use crate::ontology::validate::{parse, validate};

/// The default ontology filename inside a `.smoothie/` holding directory.
pub const ONTOLOGY_FILENAME: &str = "ontology.json";

/// A loaded, validated ontology plus the directory it lives in.
pub struct LoadedOntology {
    pub ontology: Ontology,
    #[allow(dead_code)]
    pub dir: PathBuf,
}

/// Read + validate an ontology at an explicit path. Refuses an invalid one.
pub fn load_ontology(path: &Path) -> Result<LoadedOntology> {
    let json = std::fs::read_to_string(path).map_err(|e| {
        SmoothieError::General(format!("cannot read ontology at {}: {e}", path.display()))
    })?;
    let ontology = parse(&json).map_err(|e| SmoothieError::General(format!("invalid ontology: {e}")))?;
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let report = validate(&ontology, Some(&dir));
    if !report.is_valid() {
        let detail = report
            .errors
            .iter()
            .take(5)
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(SmoothieError::General(format!(
            "ontology failed validation ({} violation(s)): {detail}",
            report.errors.len()
        )));
    }
    Ok(LoadedOntology { ontology, dir })
}

/// Resolve where the ontology lives: an explicit path, or `.smoothie/ontology.json`
/// found by walking up from `start`.
pub fn resolve_ontology_path(explicit: Option<&Path>, start: &Path) -> Result<PathBuf> {
    if let Some(p) = explicit {
        return Ok(p.to_path_buf());
    }
    let smoothie_dir = crate::storage::file::find_smoothie_dir(start)?;
    let candidate = smoothie_dir.join(ONTOLOGY_FILENAME);
    if candidate.exists() {
        Ok(candidate)
    } else {
        Err(SmoothieError::General(format!(
            "no ontology found: pass --ont <path> or place one at {}",
            candidate.display()
        )))
    }
}

/// Open the ontology for a command: explicit `--ont` path, else discover it.
pub fn open(explicit: Option<&Path>) -> Result<LoadedOntology> {
    let cwd = std::env::current_dir().map_err(SmoothieError::Io)?;
    let path = resolve_ontology_path(explicit, &cwd)?;
    load_ontology(&path)
}
