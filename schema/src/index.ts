// @smoothie/schema — the bc.v1 contract, shared by both halves of the seam.
//
// The TS frontend imports these types and validates a BC against
// `bc.v1.schema.json` on write; the Rust SVM mirrors the same schema with serde
// and validates on read (spec 07 · the bc.v1 schema as single source of truth).

export * from "./bc.v1.js";

// The canonical JSON Schema, re-exported so the frontend can validate on write
// with the same artifact the Rust side mirrors. (Resolved relative to the
// package root at runtime; bundlers should copy bc.v1.schema.json alongside.)
export const BC_V1_SCHEMA_PATH = "bc.v1.schema.json";
