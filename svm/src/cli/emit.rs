//! `svm emit skill|test …` — the SVM's one built-in producer (spec 05 · Emit).
//!
//! Web-app profile only. Resolves a slice (an outline or explicit nodes),
//! enforces the safety floor, bakes guardrails into the artifact, and writes it
//! to disk — the only side effect. Refuses to emit anything that exceeds the floor.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::bc::load;
use crate::credentials::Vault;
use crate::emit::{self, SliceSpec, Target};
use crate::error::{Result, SmoothieError};

#[derive(Serialize)]
struct EmitOutput {
    target: &'static str,
    mode: String,
    written_to: Option<String>,
    filename: String,
    credential_slots: Vec<String>,
    effective: crate::policy::EffectivePolicy,
    audit: crate::policy::audit::AuditLog,
    allow: usize,
    ask: usize,
    deny: usize,
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    bc: Option<&Path>,
    target: &str,
    outline: Option<&str>,
    nodes: &[String],
    mode: &str,
    out_dir: Option<&Path>,
    stdout: bool,
    json: bool,
    reveal: bool,
) -> Result<()> {
    let target = Target::parse(target)?;
    let mode = emit::parse_mode(mode)?;

    let spec = match (outline, nodes.is_empty()) {
        (Some(o), _) => SliceSpec::Outline(o.to_string()),
        (None, false) => SliceSpec::Nodes(nodes.to_vec()),
        (None, true) => {
            return Err(SmoothieError::InvalidArgument(
                "specify a slice: --outline <id> or one or more --node <id>".to_string(),
            ));
        }
    };

    let loaded = load::open(bc)?;
    let vault = Vault::new();
    let artifact = emit::emit(&loaded.bc, &spec, target, mode, &vault, reveal)?;
    let (allow, ask, deny) = artifact.audit.counts();

    // Write the artifact (the one side effect), unless --stdout.
    let written_to = if stdout {
        None
    } else {
        let dir = out_dir.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(&artifact.filename);
        std::fs::write(&path, &artifact.contents)?;
        Some(path.display().to_string())
    };

    if json {
        let out = EmitOutput {
            target: artifact.target_label,
            mode: artifact.mode.clone(),
            written_to: written_to.clone(),
            filename: artifact.filename.clone(),
            credential_slots: artifact.credential_slots.clone(),
            effective: artifact.effective.clone(),
            audit: artifact.audit.clone(),
            allow,
            ask,
            deny,
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    } else if stdout {
        print!("{}", artifact.contents);
    } else {
        println!(
            "✓ emitted {} ({} mode) → {}",
            artifact.target_label,
            artifact.mode,
            written_to.as_deref().unwrap_or("(stdout)")
        );
        println!("  steps: {allow} allow · {ask} gated(ask) · {deny} deny");
        if !artifact.credential_slots.is_empty() {
            println!("  credential slots: {}", artifact.credential_slots.join(", "));
        }
    }
    Ok(())
}
