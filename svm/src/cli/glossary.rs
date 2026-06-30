use serde::Serialize;
use std::collections::HashMap;
use std::env;

use crate::error::Result;
use crate::index::schema::GlossaryEntry;
use crate::storage::file as storage_file;

#[derive(Serialize)]
struct GlossaryAllOutput {
    count: usize,
    terms: HashMap<String, GlossaryEntry>,
}

impl std::fmt::Display for GlossaryAllOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Glossary ({} terms):", self.count)?;
        if self.terms.is_empty() {
            write!(f, "  (no terms yet)")?;
        } else {
            let mut terms: Vec<_> = self.terms.iter().collect();
            terms.sort_by_key(|(k, _)| *k);

            for (i, (term, entry)) in terms.iter().enumerate() {
                let def = entry.definition.as_deref().unwrap_or("(no definition)");
                if i == terms.len() - 1 {
                    write!(f, "  {} - {}", term, def)?;
                } else {
                    writeln!(f, "  {} - {}", term, def)?;
                }
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct GlossaryTermOutput {
    term: String,
    definition: Option<String>,
    refs: Vec<String>,
}

impl std::fmt::Display for GlossaryTermOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Term: {}", self.term)?;
        writeln!(
            f,
            "Definition: {}",
            self.definition.as_deref().unwrap_or("(not set)")
        )?;
        writeln!(f)?;
        writeln!(f, "References:")?;
        if self.refs.is_empty() {
            write!(f, "  (none)")?;
        } else {
            for (i, r) in self.refs.iter().enumerate() {
                if i == self.refs.len() - 1 {
                    write!(f, "  {}", r)?;
                } else {
                    writeln!(f, "  {}", r)?;
                }
            }
        }
        Ok(())
    }
}

pub fn run(term: Option<&str>, json: bool) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let index = storage_file::read_index(&smoothie_dir)?;

    match term {
        Some(term) => {
            let entry = index.get_glossary_entry(term)?;

            let output = GlossaryTermOutput {
                term: term.to_string(),
                definition: entry.definition.clone(),
                refs: entry.refs.clone(),
            };

            if json {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", output);
            }
        }
        None => {
            let output = GlossaryAllOutput {
                count: index.glossary.len(),
                terms: index.glossary.clone(),
            };

            if json {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", output);
            }
        }
    }

    Ok(())
}
