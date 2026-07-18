// @smoothie/schema — the ontology.v1 contract + the shared extraction.v1 envelope.
//
// The TS frontend validates an ontology against `ontology.v1.schema.json` on write;
// the Rust SVM mirrors the same schema with serde and validates on read (spec 07 ·
// the schema as single source of truth).

export * from "./extraction.v1.js";

// The ontology.v1 contract (spec 01), namespaced to keep its type names grouped.
export * as OntologyV1 from "./ontology.v1.js";

// The processor output contract (spec 10). External processors in any language can
// validate their stdout against this artifact.
export const EXTRACTION_V1_SCHEMA_PATH = "extraction.v1.schema.json";

// The ontology.v1 JSON Schema (spec 01), re-exported so the frontend can validate
// on write with the same artifact the Rust side mirrors.
export const ONTOLOGY_V1_SCHEMA_PATH = "ontology.v1.schema.json";
