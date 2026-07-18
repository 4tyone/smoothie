//! `svm feedback …` — the consumer-to-producer feedback channel (spec 08 §5). The
//! consuming reader records durable, provenance-stamped, governed proposals into
//! `.smoothie/feedback.jsonl`; the producer's next incremental build reads them as
//! directives (loop closure) and runs them through the SAME gates as agent proposals
//! (spec 08 §6). Nothing here mutates the ontology directly — the reader stays
//! model-free and cannot bypass verification.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;

use serde_json::json;

use crate::error::{Result, SmoothieError};

/// Append one consumer-authored feedback entry to `.smoothie/feedback.jsonl`.
fn record(mut value: serde_json::Value) -> Result<()> {
    let cwd = std::env::current_dir().map_err(SmoothieError::Io)?;
    let dir = crate::storage::file::find_smoothie_dir(&cwd)?;

    let mut h = DefaultHasher::new();
    value.to_string().hash(&mut h);
    let id = format!("fb_{:x}", h.finish());
    value["feedback_id"] = json!(id);
    value["author"] = json!("consumer");
    value["status"] = json!("pending");

    let path = dir.join("feedback.jsonl");
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(SmoothieError::Io)?;
    writeln!(f, "{}", serde_json::to_string(&value).unwrap()).map_err(SmoothieError::Io)?;
    println!("✓ recorded feedback {id} ({})", value["kind"].as_str().unwrap_or(""));
    Ok(())
}

/// An observation (a value looks stale, an entity conflates two things). Recorded,
/// never auto-applied.
pub fn note(target: &str, text: &str) -> Result<()> {
    record(json!({ "kind": "note", "targets": [target], "detail": text }))
}

/// A structured improvement ask (split this entity, re-describe this source, retype).
pub fn request(target: &str, request_kind: &str, detail: &str) -> Result<()> {
    record(json!({ "kind": "request", "targets": [target], "request_kind": request_kind, "detail": detail }))
}

/// Ask the producer to focus modeling on whether two entities connect, and how.
pub fn link_research(a: &str, b: &str, why: Option<&str>) -> Result<()> {
    record(json!({ "kind": "link_research", "targets": [a, b], "detail": why }))
}

/// Propose an entity resolution — runs through the same spec-04 gate on the next build.
pub fn propose_merge(a: &str, b: &str, why: Option<&str>) -> Result<()> {
    record(json!({ "kind": "propose_merge", "targets": [a, b], "detail": why }))
}

/// Contest an existing entity resolution.
pub fn dispute_merge(resolution_id: &str) -> Result<()> {
    record(json!({ "kind": "dispute_merge", "targets": [resolution_id] }))
}

/// Propose a missing typed link. Enters at `fidelity: guessed, author: consumer` and
/// must still satisfy G1/G3 (cited evidence + resolvable endpoints) or be quarantined.
pub fn add_link(from: &str, to: &str, link_type: &str, why: &str, facts: &[String]) -> Result<()> {
    record(json!({
        "kind": "add_link",
        "targets": [from, to],
        "link_type": link_type,
        "fact_ids": facts,
        "detail": why,
    }))
}
