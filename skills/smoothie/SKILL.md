---
name: smoothie
description: Compiles a folder of mixed-modality data (PDFs, spreadsheets, docs, HTML, JSON, notebooks, images, video, audio) into one grounded, provenance-tracked Behavior Cartridge (.smoothie/bc.json) with the `smoothie` CLI. Use when the user wants to ingest/compile/build a knowledge base or BC from local files, author or tune smoothie_config.yaml, pick a model or per-stage thinking budget, run the producer pipeline, or add new sources incrementally.
---

# Smoothie — the multimodal data compiler (producer)

Smoothie compiles a folder of messy, mixed-modality data into one queryable,
receipted **Behavior Cartridge** (`bc.v1` JSON). It is the **producer**; the
bundled **`svm`** binary is the **consumer** (see the `svm` skill).

The pipeline is `ingest → describe → structure → link → resolve → compile`. **Code
drives; the model only interprets** at describe/structure/link, behind a gateway.
Every node and edge carries `source_refs` (receipts) — the BC is **grounded by
construction**, never by the model's word.

## Quick start

```bash
smoothie login                      # once — ChatGPT-subscription (Codex OAuth)
# author <folder>/smoothie_config.yaml  (see "Config" below)
smoothie compile <folder>           # → <folder>/.smoothie/bc.json (+ telemetry, stages/)
svm query nodes --bc <folder>/.smoothie/bc.json   # consume it (svm skill)
```

A folder needs exactly one `smoothie_config.yaml`; without it `compile` aborts the
way a compiler refuses with no source.

## Commands

| Command | Does |
|---|---|
| `smoothie login` | Sign in with the ChatGPT subscription (Codex OAuth → `~/.pi/agent/auth.json`). One-time. Alternative: set `OPENAI_API_KEY`. |
| `smoothie compile <folder>` | Run the full pipeline → `<folder>/.smoothie/bc.json`, `telemetry.json`, `stages/`. Auto-incremental if a BC already exists. |
| `smoothie compile <folder> --deterministic` | Use the deterministic CI gateway (no model) — same input → byte-identical BC. For tests/plumbing, **not** real extraction. |
| `smoothie compile <folder> --resolve[=name,...]` | Also run the verify stage (promote `claimed`→`confirmed`). Bare `--resolve` runs `re-examine,cross-source`; or name them. |
| `smoothie skills install [folder]` | Copy the built-in per-modality reader skills into `<folder>/.smoothie/skills/` so you can customize them. |
| `smoothie --version` | Print the targeted schema version. |

## smoothie_config.yaml (the required input)

It carries the **Brief** (what to compile and why) **plus runtime config** (model +
per-stage thinking budget):

```yaml
version: smoothie.config.v1
profile: corpus                     # corpus | web-app
brief:
  intent: >                         # one paragraph: what this BC is for
    Compile our finance guides + sample dataset into one queryable knowledge base.
  goals:                            # each becomes a Brief-shaped outline
    - id: prepare
      text: explain how to prepare a company's financial statements
  glossary:                         # optional seed terms
    - { term: income statement, definition: revenues, expenses, profit over a period }
  manifest: { author: Mels, organization: 4tyone }
model:
  default: openai-codex/gpt-5.5     # optional; omit to use your auth default
stages:                             # optional; these ARE the defaults
  describe:  { thinking: minimal }  # mechanical extraction → fast
  structure: { thinking: low }      # per-source local graph
  link:      { thinking: medium }   # cross-graph synthesis earns more
```

Full schema + the `web-app` profile + `scope`/`verify`/`policy` blocks:
[references/config.md](references/config.md).

## Where output lands — `.smoothie/` is the unified home

```
<folder>/.smoothie/
  bc.json            # the Behavior Cartridge (the deliverable; git-committed)
  telemetry.json     # per-stage counts (reconstructs the run)
  stages/            # every stage's output as a file (gitignored)
    1-ingest.json … 5-resolve.json
    describe/<source_id>.json   # per-source describe CACHE (keyed by content hash)
  work/<source_id>/  # the agent's Python + a copy of the source (gitignored)
  skills/<modality>/ # optional project overrides of the reader skills
```

The **describe cache** is the key efficiency feature: `describe` is
Brief-independent, so re-compiling — or compiling the *same data with a different
Brief* — reuses the expensive extraction instead of re-reading every file. Delete a
`stages/describe/<id>.json` (or change the source) to force re-extraction.

## How extraction works (the agent-writes-Python reader)

`describe` is not a fixed set of parsers. For each source the model runs as a
**tool-calling agent** that **writes and runs Python** (pdfplumber, pandas, PyMuPDF,
…) in `.smoothie/work/<source>/`, guided by a **per-modality skill**. It cites a
`locator` per fact, which **code** turns into a provenance span. Modalities and how
to customize a reader skill: [references/readers.md](references/readers.md).

## What each stage does, caching, and incrementality

`ingest` (config + classify sources) → `describe` (sources→facts, cached) →
`structure` (per-source local graph; batched into one model call for the real
gateway) → `link` (weave into one graph, induce cross-source edges, reconcile
Brief-shaped outlines) → `resolve` (optional promote to `confirmed`) → `compile`
(assemble, roll up, write, **validate via `svm`**). Details, the incremental
guarantee, and fidelity levels: [references/pipeline.md](references/pipeline.md).

## Caveats & neat tricks

- **`smoothie_config.yaml` and `.smoothie/` are always ignored** as sources. Exclude
  more with a `.smoothieignore` (gitignore-style) in the folder.
- **Same data, many Briefs** — point three different `smoothie_config.yaml` files at
  one corpus; `describe` is cached, so only structure/link/compile re-run. The Brief
  reshapes outlines + linking, cheaply.
- **Per-stage tuning pays off.** The soak found `link: { thinking: medium }` with
  content-rich context roughly 4× the cross-source edges vs the old title-only/low
  default — at some precision cost (induced edges are honestly `guessed`). Bump
  `link.thinking` for richer connections; lower it for speed.
- **`model.default` accepts `provider/modelId` or just `modelId`** (falls back to
  your authenticated provider). A stage can override the global model.
- **Every compile git-commits the BC** under `.smoothie/` — history/rollback/diff
  work (see `svm bc` in the `svm` skill).
- **Determinism is for CI only.** `--deterministic` never does real extraction; it
  exists so "same input → same BC" stays testable without a non-deterministic model.
- **Validation is the gate.** `compile` fails if the produced BC violates a
  provenance guarantee (e.g. an edge endpoint that isn't a real node) — a feature,
  not a bug. Read the `svm validate` error; it names the offending edge/node.
