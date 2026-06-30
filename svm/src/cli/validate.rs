//! `svm validate <bc.json>` — Phase 0's test gate (PHASES · Phase 0).
//!
//! Loads a BC, runs serde schema validation + the four provenance-guarantee
//! gates (spec 02), and reports the result. Exit 0 if valid; non-zero with a
//! per-violation report otherwise. This proves the seam before either producer
//! half exists: a hand-authored golden BC passes, deliberately-broken BCs fail.

use std::path::Path;

use serde::Serialize;

use crate::bc::validate::{validate_file, ValidationError};
use crate::error::{Result, SmoothieError};

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

pub fn run(path: &Path, json: bool) -> Result<()> {
    let report = match validate_file(path) {
        Ok(report) => report,
        // A parse/IO failure is itself an invalid BC (it never reached the gates).
        Err(parse_err) => {
            emit(path, std::slice::from_ref(&parse_err), json);
            return Err(SmoothieError::BcInvalid(1));
        }
    };

    emit(path, &report.errors, json);

    if report.is_valid() {
        Ok(())
    } else {
        Err(SmoothieError::BcInvalid(report.errors.len()))
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
        println!("✓ {} is a valid bc.v1 BC", path.display());
    } else {
        eprintln!(
            "✗ {} failed validation with {} violation(s):",
            path.display(),
            errors.len()
        );
        for e in errors {
            eprintln!("  {e}");
        }
    }
}
