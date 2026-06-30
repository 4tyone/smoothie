// bc.v1 — the Smoothie BC contract, as TypeScript types (spec 02).
//
// This file and `../bc.v1.schema.json` are the single source of truth for the
// producer (TS) side of the seam; `svm/src/bc/types.rs` is the Rust serde mirror
// for the consumer side. Keep all three in lockstep — a breaking change bumps
// `bc.v2` in every one of them.

export const SCHEMA_VERSION = "bc.v1" as const;
export const PROFILE_WEB_APP = "web-app" as const;

export type Fidelity = "confirmed" | "claimed" | "guessed" | "absent";

export type Bc = {
  schema: typeof SCHEMA_VERSION;
  manifest: Manifest;
  brief?: Brief;
  sources: Record<string, Source>;
  facts: Record<string, Fact>;
  graph: Graph;
  views: Record<string, View>;
  outlines: Record<string, Outline>;
  glossary: Record<string, GlossaryEntry>;
  notes: Record<string, Note>;
  cache: Cache;
  policy: Policy;
  extensions: Extensions;
};

// ─── Manifest ────────────────────────────────────────────────────────────────

export type Manifest = {
  bc_id: string;
  profile: string; // target profile, e.g. "web-app" | "codebase" | "corpus"
  app?: { name?: string; app_ref?: string; base_url?: string; allowed_origins?: string[] }; // web-app only
  producer: { name: "smoothie"; version: string; commit?: string };
  created_at: string;
  updated_at: string;
  counts: { sources: number; facts: number; nodes: number; edges: number; views: number; outlines: number };
  authorship?: { author?: string; organization?: string; signature?: string };
};

// ─── Brief ───────────────────────────────────────────────────────────────────

export type Brief = {
  brief_id: string;
  text: string;
  goals: Goal[];
  scope?: { include?: string[]; exclude?: string[] };
  created_at: string;
};

export type Goal = { id: string; text: string; done_when?: string };

// ─── Sources ─────────────────────────────────────────────────────────────────

export type Source = {
  source_id: string;
  kind: string; // Reader modality tag (spec 04)
  path?: string;
  uri?: string;
  hash?: string;
  title?: string;
  media_type?: string;
  companions: Companion[];
  metadata?: Record<string, unknown>;
};

export type Companion = {
  kind: "transcript" | "frame" | "screenshot" | "dom" | "ax" | "audio" | "other";
  path: string;
  hash?: string;
  source_span?: SourceSpan;
};

// ─── Facts ───────────────────────────────────────────────────────────────────

export type Fact = {
  fact_id: string;
  kind: "knowledge" | "action";
  text: string;
  confidence: number; // 0..1
  view_id?: string;
  fidelity: Fidelity;
  source_refs: SourceRef[];
  brief_id?: string;
  action_draft?: ActionDraft;
};

export type ActionDraft = {
  verb: "goto" | "click" | "fill" | "select" | "press" | "scroll" | "wait_for" | "unknown";
  target: string;
  value_hint?: string;
  locator_hint?: string;
  expected_effect?: string;
};

// ─── Graph ───────────────────────────────────────────────────────────────────

export type Graph = {
  nodes: Record<string, Node>;
  edges: Edge[];
  roots?: string[];
};

export type Node = {
  id: string;
  title: string;
  summary: string | null;
  kind: string; // profile vocabulary — web-app: "screen"|"feature"|"flow"|"action"
  view_id?: string;
  fact_ids: string[];
  action?: Action; // web-app profile payload; other profiles use extensions
  checks: Check[];
  done_when?: string;
  fidelity: Fidelity;
  source_refs: SourceRef[];
};

export type Edge = {
  from: string;
  to: string;
  kind: "contains" | "transition" | "enables" | "depends_on" | "next" | "related_to";
  label?: string;
  fidelity: Fidelity;
  source_refs: SourceRef[];
};

// ─── Action / Locator / Check (web-app profile payload) ──────────────────────

export type Action =
  | { kind: "goto"; url: string }
  | { kind: "click"; locator: Locator }
  | { kind: "fill"; locator: Locator; value: string }
  | { kind: "select"; locator: Locator; value: string }
  | { kind: "press"; key: string }
  | { kind: "scroll"; locator?: Locator; to?: "element" | "top" | "bottom" }
  | { kind: "wait_for"; locator?: Locator; condition?: string };

export type LocatorStrategy = {
  by: "role" | "testid" | "label" | "text" | "css";
  value: string;
  name?: string;
};

export type Locator = {
  description: string;
  primary: LocatorStrategy;
  fallbacks: LocatorStrategy[];
};

export type Check =
  | { kind: "visible"; locator: Locator }
  | { kind: "exists"; locator: Locator }
  | { kind: "text_matches"; locator?: Locator; expected: string }
  | { kind: "url_matches"; expected: string };

// ─── Views ───────────────────────────────────────────────────────────────────

export type View = {
  view_id: string;
  title: string;
  url_patterns?: string[]; // web-app
  node_ids: string[];
  fidelity: Fidelity;
  observations: Observation[];
  aliases?: string[];
};

export type Observation = {
  observation_id: string;
  source_ref: SourceRef;
  url: string;
  captured_at: string;
  mode: "read-only" | "dry-run" | "live";
  ax_snapshot?: string;
  dom_snapshot?: string;
  screenshot?: string;
};

// ─── Outlines ────────────────────────────────────────────────────────────────

export type Outline = {
  outline_id: string;
  brief_id: string;
  title: string;
  scenes: Scene[];
  fidelity: Fidelity;
};

export type Scene = {
  scene_id: string;
  title: string;
  node_ids: string[];
  done_when?: string;
  fidelity: Fidelity;
  gaps?: string[]; // note keys, usually `gap:*`
};

// ─── Provenance ──────────────────────────────────────────────────────────────

export type SourceRef = {
  source_id: string;
  span: SourceSpan;
};

export type SourceSpan =
  | { kind: "time"; t_start: number; t_end: number }
  | { kind: "doc"; page?: number; section?: string; lines?: [number, number]; label?: string }
  | { kind: "crawl"; page_id: string; url?: string } // web-app resolution receipt
  | { kind: "live"; note: string } // web-app resolution receipt
  | { kind: "resolve"; resolver: string; ref: string; note?: string }; // generic Resolver receipt

// ─── Substrate sections ──────────────────────────────────────────────────────

export type GlossaryEntry = { definition: string; references?: string[] };

export type Note = { text: string; kind?: string; refs?: SourceRef[] };

export type Cache = {
  hot?: unknown[];
  trending?: unknown[];
  shadow?: unknown[];
  [extra: string]: unknown;
};

// ─── Policy (spec 06) ────────────────────────────────────────────────────────

export type Policy = {
  scope?: { allowed_origins: string[]; url_denylist: string[]; same_origin_only: boolean };
  actions?: {
    blocklist_verbs: string[];
    allow_irreversible: boolean;
    allow_form_submit: boolean;
    allow_rules: { match: string; reason: string }[];
    danger: { match: string; level: "block" | "approve" | "supervise"; reason: string }[];
  };
  budget?: { max_actions?: number; max_pages?: number; max_depth?: number; max_cost?: number; max_seconds?: number };
  approval?: { require_for: "none" | "irreversible" | "all-mutations"; handler: "interactive" | "policy-only" };
  secrets?: { redact_patterns: string[] };
};

// ─── Extensions ──────────────────────────────────────────────────────────────

// Keys must be reverse-DNS namespaces, e.g. "com.smoothie.reader.video".
export type Extensions = Record<string, unknown>;
