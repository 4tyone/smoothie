pub mod cache;
pub mod feedback;
pub mod glossary;
pub mod history;
pub mod hit;
pub mod init;
pub mod node;
pub mod notes;
pub mod ontology;
pub mod rollback;
pub mod skill;
pub mod sync;
pub mod validate;
pub mod write;

use serde::Serialize;

/// Output format enum for commands
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Human,
    Json,
}

/// Format output based on the selected format
pub fn format_output<T: Serialize + std::fmt::Display>(value: &T, format: OutputFormat) -> String {
    match format {
        OutputFormat::Human => value.to_string(),
        OutputFormat::Json => {
            serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
        }
    }
}

/// Print output to stdout with appropriate formatting
pub fn print_output<T: Serialize + std::fmt::Display>(value: &T, json: bool) {
    let format = if json {
        OutputFormat::Json
    } else {
        OutputFormat::Human
    };
    println!("{}", format_output(value, format));
}
