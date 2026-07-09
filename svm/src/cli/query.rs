//! `svm query …` — the SVM's primary surface (spec 05). Each subcommand opens the
//! BC (explicit `--bc` or discovered `.smoothie/bc.json`), runs a deterministic
//! query, and prints grounded data (`--json` for machine consumption).

use std::path::Path;

use crate::bc::load;
use crate::error::Result;
use crate::query::{self, display, Direction};

fn print<T: serde::Serialize + std::fmt::Display>(value: &T, json: bool) {
    if json {
        println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
    } else {
        print!("{value}");
    }
}

pub fn node(bc: Option<&Path>, id: &str, reveal: bool, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::node(&loaded.bc, id, reveal)?;
    print(&result, json);
    Ok(())
}

pub fn edges(
    bc: Option<&Path>,
    id: &str,
    kind: Option<&str>,
    direction: &str,
    json: bool,
) -> Result<()> {
    let loaded = load::open(bc)?;
    let kind = kind.map(query::parse_edge_kind).transpose()?;
    let result = query::edges(&loaded.bc, id, kind, Direction::parse(direction)?)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        print!("{}", display::EdgeList(&result));
    }
    Ok(())
}

pub fn view(bc: Option<&Path>, view_id: &str, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::view(&loaded.bc, view_id)?;
    print(&result, json);
    Ok(())
}

pub fn outline(bc: Option<&Path>, outline_id: &str, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::outline(&loaded.bc, outline_id)?;
    print(&result, json);
    Ok(())
}

pub fn nodes(bc: Option<&Path>, fidelity: Option<&str>, kind: Option<&str>, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let fidelity = fidelity.map(query::parse_fidelity).transpose()?;
    let result = query::nodes(&loaded.bc, fidelity, kind);
    if json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        print!("{}", display::NodeSummaryList(&result));
    }
    Ok(())
}

pub fn gaps(bc: Option<&Path>, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::gaps(&loaded.bc);
    if json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        print!("{}", display::GapList(&result));
    }
    Ok(())
}

pub fn glossary(bc: Option<&Path>, term: Option<&str>, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::glossary(&loaded.bc, term);
    if json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        print!("{}", display::GlossaryList(&result));
    }
    Ok(())
}

pub fn notes(bc: Option<&Path>, key: Option<&str>, json: bool) -> Result<()> {
    let loaded = load::open(bc)?;
    let result = query::notes(&loaded.bc, key);
    if json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
    } else {
        print!("{}", display::NoteList(&result));
    }
    Ok(())
}

pub fn traverse(
    bc: Option<&Path>,
    from: &str,
    kind: Option<&str>,
    max_depth: usize,
    json: bool,
) -> Result<()> {
    let loaded = load::open(bc)?;
    let kind = kind.map(query::parse_edge_kind).transpose()?;
    let result = query::traverse(&loaded.bc, from, kind, max_depth)?;
    print(&result, json);
    Ok(())
}
