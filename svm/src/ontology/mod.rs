//! `ontology` — the `ontology.v1` contract on the consumer side (spec 01): the
//! serde mirror of `schema/ontology.v1` (`types`) and the G1-G7 validator
//! (`validate`). Net-new for the ontology track, built alongside `bc` until the
//! default flip (spec 09 §2/§6.3).

pub mod load;
pub mod query;
pub mod types;
pub mod validate;

// Re-exported as the crate's public ontology surface; `#[allow]` because Phase 1
// wires only the validator path — query/consumer land in Phase 5 (spec 09 §6.4).
#[allow(unused_imports)]
pub use types::*;
#[allow(unused_imports)]
pub use validate::{parse, validate, validate_file, ValidationError, ValidationReport};
