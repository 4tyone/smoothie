//! `svm skill` — the killer skill (spec 05 · The killer skill).
//!
//! Ships the `SKILL.md` that teaches any agent the BC command surface. Print it
//! (default) or `--install` it next to a BC so the agent is productive immediately
//! with no model-time learning.

use std::path::Path;

use crate::error::{Result, SmoothieError};

/// The skill is compiled into the binary so `svm` stays a single standalone artifact.
const SKILL_MD: &str = include_str!("../../assets/SKILL.md");

pub fn run(install_dir: Option<&Path>) -> Result<()> {
    match install_dir {
        None => {
            print!("{SKILL_MD}");
            Ok(())
        }
        Some(dir) => {
            std::fs::create_dir_all(dir)?;
            let path = dir.join("SKILL.md");
            std::fs::write(&path, SKILL_MD).map_err(SmoothieError::Io)?;
            println!("✓ installed SKILL.md → {}", path.display());
            Ok(())
        }
    }
}
