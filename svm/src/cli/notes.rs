use serde::Serialize;
use std::collections::HashMap;
use std::env;

use crate::error::Result;
use crate::storage::file as storage_file;

#[derive(Serialize)]
struct NotesAllOutput {
    count: usize,
    notes: HashMap<String, String>,
}

impl std::fmt::Display for NotesAllOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Notes ({} entries):", self.count)?;
        if self.notes.is_empty() {
            write!(f, "  (no notes yet)")?;
        } else {
            let mut notes: Vec<_> = self.notes.iter().collect();
            notes.sort_by_key(|(k, _)| *k);

            for (i, (key, value)) in notes.iter().enumerate() {
                if i == notes.len() - 1 {
                    write!(f, "  {}: {}", key, value)?;
                } else {
                    writeln!(f, "  {}: {}", key, value)?;
                }
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct NotesKeyOutput {
    key: String,
    value: String,
}

impl std::fmt::Display for NotesKeyOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Key: {}", self.key)?;
        write!(f, "Value: {}", self.value)
    }
}

pub fn run(key: Option<&str>, json: bool) -> Result<()> {
    let cwd = env::current_dir()?;
    let smoothie_dir = storage_file::find_smoothie_dir(&cwd)?;

    let index = storage_file::read_index(&smoothie_dir)?;

    match key {
        Some(key) => {
            let value = index.get_note(key)?;

            let output = NotesKeyOutput {
                key: key.to_string(),
                value: value.clone(),
            };

            if json {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", output);
            }
        }
        None => {
            let output = NotesAllOutput {
                count: index.notes.len(),
                notes: index.notes.clone(),
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
