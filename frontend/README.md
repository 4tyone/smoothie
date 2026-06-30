# `frontend/` — the Smoothie compiler frontend (TS, on Pi)

The **producer** half of the seam (spec 01/07): the interpretive compiler
frontend that reads messy multimodal data and emits a `bc.v1` BC. Built in
TypeScript on **Pi** (`@earendil-works/pi-ai`) — the model API, tool-calling,
structured output, ChatGPT-subscription auth, and an in-process agent loop. (We
started on Flue but Flue is an HTTP-server harness that doesn't fit a one-shot CLI
compiler — see ADR-0002; Pi is the engine Flue is built on.) The `describe` stage
gives the agent a `run_python` tool and a per-modality **skill**, so it writes
Python to extract from any source. It is the `smoothie` authoring CLI (ADR-0001)
and bundles the `svm` binary.

## Status — Phase 2 (the producer thread)

```
smoothie compile <folder> [--deterministic]
```

Implements `ingest → describe → structure → compile` (link/resolve land in
Phases 3/5):

- **ingest** (`stages/ingest.ts`) — the required `brief.yaml` is schema-validated
  (aborts if missing/invalid), each file is classified by modality and registered
  as a source, and the Brief's fields fan out to the BC sections.
- **describe** (`stages/describe.ts`) — Readers (`readers/`: **pdf · docs ·
  spreadsheet · markdown**) extract segments; the model turns each into the
  canonical `Fact` shape. **Provenance is attached by code** (the segment span),
  never by the model.
- **structure** (`stages/structure.ts`) — facts → nodes/views/within-source
  edges/outlines; code materializes every node/edge `source_refs` from the facts
  it rests on (receipted by construction).
- **compile** (`stages/compile.ts`) — assembles the BC, computes fidelity
  rollups, writes `bc.json` deterministically (sorted keys, no wall-clock), and
  enforces the provenance gates by invoking the real `svm validate`.

### The model gateway (`model/`)

The interpretive stages call a `ModelGateway` (spec 07 · deterministic CI mode
beside the real path):

- **`RealModelGateway`** — the real path on Pi, default `gpt-5.5` (ChatGPT subscription or API key),
  keys from the environment. Requires a key; run `smoothie compile <folder>`.
- **`DeterministicModelGateway`** — model-free CI determinism harness. Run
  `smoothie compile <folder> --deterministic`. The test suite uses it.

### Tests

`pnpm test` (vitest) runs the **Phase 2 gate**: a real source → a valid BC the
Phase-1 SVM consumes and serves (query, traverse, emit) — byte-identical across
re-runs (matches the recorded golden in `test/fixtures/golden/`). The remaining
Readers and the full multimodal set round out in Phase 4.

> Dev runs use `tsx` (no build step). Emitting a published `dist/` bin is a
> packaging concern deferred past the Phase 2 gate.
