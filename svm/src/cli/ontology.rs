//! `svm ontology …` — the typed, model-free query surface over `ontology.json`
//! (spec 06). Each subcommand opens the ontology (explicit `--ont` or discovered
//! `.smoothie/ontology.json`), runs a deterministic query, and prints grounded,
//! receipted data (`--json` for machine consumption). The reader never runs a model.

use std::path::Path;

use serde::Serialize;

use crate::error::Result;
use crate::ontology::{load, query};

fn print<T: Serialize>(value: &T, _json: bool) {
    // Structured, receipted data is always emitted as JSON (the reader's contract).
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
}

pub fn types(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::types(&loaded.ontology), json);
    Ok(())
}

pub fn entities(ont: Option<&Path>, type_filter: Option<&str>, interface_filter: Option<&str>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::entities(&loaded.ontology, type_filter, interface_filter), json);
    Ok(())
}

pub fn interfaces(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::interfaces(&loaded.ontology), json);
    Ok(())
}

pub fn logic_units(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::logic_units(&loaded.ontology), json);
    Ok(())
}

pub fn conformance(ont: Option<&Path>, only: Option<&str>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::conformance(&loaded.ontology, only), json);
    Ok(())
}

pub fn drift(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::drift(&loaded.ontology), json);
    Ok(())
}

pub fn entity(ont: Option<&Path>, id: &str, reveal: bool, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::entity(&loaded.ontology, id, reveal)?, json);
    Ok(())
}

pub fn facts(ont: Option<&Path>, entity_id: &str, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::facts(&loaded.ontology, entity_id)?, json);
    Ok(())
}

pub fn links(ont: Option<&Path>, entity_id: &str, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::links(&loaded.ontology, entity_id)?, json);
    Ok(())
}

pub fn traverse(ont: Option<&Path>, from: &str, depth: usize, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::traverse(&loaded.ontology, from, depth)?, json);
    Ok(())
}

pub fn resolve(ont: Option<&Path>, id: &str, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::resolve(&loaded.ontology, id)?, json);
    Ok(())
}

pub fn search(ont: Option<&Path>, term: &str, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::search(&loaded.ontology, term), json);
    Ok(())
}

pub fn gaps(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    print(&query::gaps(&loaded.ontology), json);
    Ok(())
}

#[derive(Serialize)]
struct ShowView {
    ontology_id: String,
    profile: String,
    version_id: String,
    entities: usize,
    entity_types: usize,
    links: usize,
    resolutions: usize,
    facts: usize,
    sources: usize,
}

pub fn show(ont: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(ont)?;
    let o = &loaded.ontology;
    let view = ShowView {
        ontology_id: o.manifest.ontology_id.clone(),
        profile: o.manifest.profile.clone(),
        version_id: o.version.version_id.clone(),
        entities: o.entities.len(),
        entity_types: o.entity_types.len(),
        links: o.links.len(),
        resolutions: o.resolutions.len(),
        facts: o.facts.len(),
        sources: o.sources.len(),
    };
    print(&view, json);
    Ok(())
}
