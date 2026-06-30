//! `bc` — the `bc.v1` contract on the consumer side: the serde mirror of
//! `schema/bc.v1` (`types`) and the provenance-guarantee validator (`validate`).
//!
//! This is the keystone of the seam (spec 01/02): the TS frontend produces a BC
//! and validates it on write; the SVM mirrors the same schema with serde and
//! re-validates on read. Net-new for Smoothie (the substrate had no BC layer).

pub mod load;
pub mod types;
pub mod validate;

// Re-exported as the crate's public BC surface; `#[allow]` because the `svm`
// binary pulls in this module too, where the re-exports go unused.
#[allow(unused_imports)]
pub use types::*;
#[allow(unused_imports)]
pub use validate::{parse, validate, validate_file, ValidationError, ValidationReport};
