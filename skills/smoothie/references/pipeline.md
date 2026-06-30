# The pipeline — stages, caching, incrementality, fidelity

`ingest → describe → structure → link → resolve → compile`. Code drives; the model
interprets only at describe/structure/link. Each stage writes its output to
`.smoothie/stages/` so the run is a sequence of inspectable files, not one opaque
pass.

## Stages

1. **ingest** (code). Reads + validates `smoothie_config.yaml`, fans the Brief out to
   BC sections, classifies each file's modality, registers sources (hash + relpath),
   honors `.smoothieignore`. Aborts if the config is missing/invalid. → `1-ingest.json`.

2. **describe** (agent, per modality). Each source → **facts** in one canonical shape.
   The real path runs a Python-writing agent (see readers.md); the deterministic path
   uses a trivial text splitter (CI only). Provenance attached by **code** from the
   agent's `locator`. **Cached** per source by content hash in
   `stages/describe/<source_id>.json` — Brief-independent, so a different Brief over
   the same data reuses it. → `2-describe.json`.

3. **structure** (agent, local). Each source's facts → a **local object** (nodes in
   the profile vocabulary, first-class views, within-source edges). For the **real**
   gateway all sources are structured in **one batched call** (fewer round-trips,
   leverages the context window); the deterministic gateway stays per-source so the
   golden stays byte-identical. Code materializes `source_refs` on every node/edge;
   edges whose endpoints aren't real nodes are dropped, and view→node containment is
   folded into the view's `node_ids`. → `3-structure.json`.

4. **link** (agent, global). Weaves the locals into ONE graph: merges duplicate
   views, **induces cross-source edges** (`guessed` fidelity, citing both endpoints'
   receipts), reconciles **one Brief-shaped outline per goal**, records unconnectable
   nodes as `gap:` notes. The linker reasons over node **summaries + representative
   facts** (not titles alone). A final guard drops any edge not between two real
   nodes. → `4-link.json`.

5. **resolve** (optional). Promotes `claimed`/`guessed` → `confirmed` **in place**
   when a Resolver is requested (`verify.resolvers` or `--resolve`). Offline,
   deterministic resolvers: `cross-source` (an independent source corroborates) and
   `re-examine` (re-read the bytes). No resolver → no-op. → `5-resolve.json`.

6. **compile** (code). Assembles the BC, computes rollups, writes `bc.json`,
   **validates via the `svm` binary** (the producer never trusts itself), git-commits.

Telemetry counts per stage are in `telemetry.json`. Note `link` reports both
`induced_edges` (all edges the linker added) and `cross_source_edges` (endpoints in
*different* sources — the honest, smaller number).

## Incremental by construction

Re-running `compile` on a folder that already has `.smoothie/bc.json` processes only
**new** sources (a `source_id` not already present) and weaves them in at `link` —
**existing nodes are carried over verbatim** (byte-identical). Every compile is a git
commit, so `svm bc history`/`rollback`/diff work. Disable with an explicit full
recompile by removing `.smoothie/bc.json`.

## Fidelity levels (honesty discipline)

- `claimed` — asserted by one source (the default for extracted facts/nodes).
- `guessed` — inferred, not directly stated (e.g. induced cross-source edges, an
  action node the model proposed). Honestly lower trust.
- `confirmed` — corroborated by a Resolver, with a `resolve` receipt + an evaluated
  check. Only the resolve stage produces these; the web-app profile stays `claimed`
  until a live run confirms it.

Nothing is silently upgraded; the `svm validate` honest-fidelity gate enforces it.

## Environment variables

- `SMOOTHIE_REASONING` — overrides the describe agent's default thinking (`minimal`).
  Per-stage `stages.describe.thinking` in the config takes precedence.
- `SMOOTHIE_NOW` — fixes the ingest timestamp (used by deterministic tests).
- `OPENAI_API_KEY` — pay-per-token fallback when not using the ChatGPT subscription.
