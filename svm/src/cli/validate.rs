//! `svm validate <ontology.json>` — loads an ontology and runs the schema check plus
//! gates G1-G7 (spec 01 §8), fail-closed. Exit 0 if valid; non-zero with a
//! per-violation report otherwise. The producer's `compile` calls this too.

use std::path::Path;

use serde::Serialize;

use crate::error::{Result, SmoothieError};
use crate::ontology::validate::ValidationError;

#[derive(Serialize)]
struct ValidateOutput {
    valid: bool,
    path: String,
    error_count: usize,
    errors: Vec<ReportedError>,
}

#[derive(Serialize)]
struct ReportedError {
    code: &'static str,
    location: String,
    message: String,
}

/// `svm validate <ontology.json>` — validate against `ontology.v1` and gates G1-G7.
pub fn run(path: &Path, json: bool) -> Result<()> {
    let errors = match crate::ontology::validate::validate_file(path) {
        Ok(report) => report.errors,
        // A parse/IO failure is itself an invalid ontology (it never reached the gates).
        Err(parse_err) => vec![parse_err],
    };

    emit(path, &errors, json);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(SmoothieError::BcInvalid(errors.len()))
    }
}

fn emit(path: &Path, errors: &[ValidationError], json: bool) {
    if json {
        let out = ValidateOutput {
            valid: errors.is_empty(),
            path: path.display().to_string(),
            error_count: errors.len(),
            errors: errors
                .iter()
                .map(|e| ReportedError {
                    code: e.code,
                    location: e.location.clone(),
                    message: e.message.clone(),
                })
                .collect(),
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        return;
    }

    if errors.is_empty() {
        println!("✓ {} is a valid ontology.v1 ontology", path.display());
    } else {
        eprintln!("✗ {} failed validation with {} violation(s):", path.display(), errors.len());
        for e in errors {
            eprintln!("  {e}");
        }
    }
}
