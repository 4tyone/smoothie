<div align="center">

<img src="smoothie_logo.png" alt="Smoothie" width="200" />

# Smoothie

**Blend your scattered data into one grounded, queryable bytecode.**

*A multimodal data compiler. Point it at a folder of messy files — PDFs, spreadsheets,
docs, images, video, audio, code — and it compiles them into a single,
provenance-tracked **bytecode** (the BC) your agents can query, traverse, and trust.*

![SVM](https://img.shields.io/badge/SVM-Rust-orange?logo=rust&logoColor=white)
![Producer](https://img.shields.io/badge/Producer-TypeScript-3178c6?logo=typescript&logoColor=white)
![Engine](https://img.shields.io/badge/runs%20on-Pi-8a2be2)
![Contract](https://img.shields.io/badge/contract-bc.v1-success)
![Grounded](https://img.shields.io/badge/every%20fact-receipted-brightgreen)

</div>

---

## Why Smoothie

An organization's knowledge is scattered across documents, spreadsheets, recordings,
and SaaS exports. Smoothie **compiles** all of it into one artifact — the **bytecode**
(`bc.v1`, the "BC") — where every fact carries a **receipt** back to its source, and
a deterministic runtime serves it to your agents without a model in the loop.

Two halves, one contract:

```
   your data ──▶  Smoothie (producer, TypeScript on Pi)  ──▶  bc.json  ──▶  SVM (consumer, Rust)  ──▶  your agents
                  ingest→describe→structure→link→resolve→compile      the bc.v1 contract        query · traverse · emit
```

- **Grounded by construction** — code attaches a provenance span to every node and
  edge. The model proposes; code materializes the receipt. Nothing is trusted on the
  model's word.
- **The model orchestrates a data-engineering toolkit** — `describe` runs as a
  tool-calling agent that drives pre-built, per-modality Python scripts (transcribe a
  video, profile a spreadsheet, OCR a PDF) and writes code only for the data-specific
  glue. So a spreadsheet becomes an analytical schema, not a cell dump.
- **One corpus, many questions** — extraction is cached; a new Brief reshapes the
  graph without re-reading a single file.
- **Safe by design** — the bytecode is inert data; the SVM never executes what's
  inside it. Read restrictions and a deny-by-default execution floor are enforced in
  code, never from a prompt.

## Data as code — compiled, not parsed

Smoothie treats your data the way a compiler treats source. Java doesn't re-parse your
`.java` files every time the program runs — **`javac` compiles them once into portable
bytecode, and the JVM executes that bytecode** anywhere, deterministically, inside a
sandbox. Smoothie is the same shape: the **Smoothie compiler** turns raw, scattered
multimodal data into a portable **bytecode** (`bc.v1` — the "BC"), and
the **SVM — the Smoothie *Virtual Machine*** — executes and serves it deterministically,
behind a safety floor (the sandbox). `bc.v1` is the classfile format both sides agree on.

That makes data **first-class, code-grade artifacts**: the bytecode is versioned,
diffable, roll-back-able, signable, and shippable — you compile understanding once and
run it everywhere, instead of re-deriving it from scratch on every query.

## How it works

```mermaid
flowchart LR
    A[smoothie_config.yaml<br/>+ data folder] --> I(ingest)
    I --> D(describe<br/>agent writes Python)
    D --> S(structure)
    S --> L(link<br/>cross-source edges)
    L --> R(resolve)
    R --> C(compile<br/>validate via svm)
    C --> BC[(bc.json)]
    BC --> Q[svm query / traverse]
    BC --> E[svm emit<br/>web-app only]
    style BC fill:#8a2be2,color:#fff
```

Each stage writes its output to `.smoothie/stages/` — the run is a sequence of
inspectable files, not one opaque pass. `describe` is cached per source by content
hash, so re-compiling (or compiling the same data under a different Brief) reuses the
expensive extraction.

## Install

Smoothie is built from source — two halves plus a couple of runtime tools.

**Prerequisites:** [Rust/cargo](https://rustup.rs), [Node ≥ 22.19](https://nodejs.org)
+ [pnpm](https://pnpm.io), [`uv`](https://docs.astral.sh/uv/) (runs the Python toolkit),
and `ffmpeg` (video/audio). `tesseract` is optional (OCR).

```bash
git clone <repo> smoothie && cd smoothie

# 1 · build the SVM (consumer, Rust) → target/release/svm
cargo build --release

# 2 · build the producer (TypeScript) and expose the `smoothie` CLI
cd frontend && pnpm install && pnpm build && pnpm link --global && cd ..
#   (in dev you can skip the build and run `pnpm exec tsx src/cli.ts <args>`)

# 3 · put `svm` on your PATH
export PATH="$PWD/target/release:$PATH"
```

**Python dependencies install themselves, lazily.** Nothing heavy is fetched at install
time: the shared `describe` venv is provisioned on the first `compile`, and every
toolkit script declares its own deps inline (PEP 723) so `uv run` builds an isolated,
cached environment **per script on first use** — `faster-whisper` for video never bloats
the JSON reader, and offline/local throughout.

## Quick start

```bash
# 1 · sign in once (ChatGPT subscription via Codex OAuth) — or set OPENAI_API_KEY
smoothie login

# 2 · drop a smoothie_config.yaml in your data folder (see below), then compile
smoothie compile ./my-data            # → ./my-data/.smoothie/bc.json

# 3 · consume the bytecode with the SVM (no model, fully deterministic)
svm query nodes    --bc ./my-data/.smoothie/bc.json
svm query node     <id> --bc ./my-data/.smoothie/bc.json   # facts + receipts
svm query traverse <id> --bc ./my-data/.smoothie/bc.json --depth 2
```

### `smoothie_config.yaml`

The one required input — the **Brief** (what to compile and why) plus runtime config
(model + per-stage thinking budget):

```yaml
version: smoothie.config.v1
profile: corpus                       # corpus | web-app
brief:
  intent: >
    Compile our finance guides and the sample dataset into one queryable,
    provenance-tracked knowledge base an analyst can navigate.
  goals:                              # each goal becomes a Brief-shaped outline
    - { id: understand, text: explain how to read a company's core statements }
    - { id: sales-data, text: summarize what the sample dataset contains }
model:
  default: openai-codex/gpt-5.5       # optional
stages:                               # optional; these are the defaults
  describe:  { thinking: minimal }    # mechanical extraction → fast
  structure: { thinking: low }
  link:      { thinking: medium }     # cross-graph synthesis earns more
```

## The bytecode (`bc.v1`)

A single JSON document: a **graph** of `nodes` (topics / screens) and `edges` (typed
relationships), grouped into `views`, threaded by Brief-shaped `outlines`, with a
`fact` pool and a `manifest`. Every node and edge has `source_refs` — its receipts.

Fidelity is honest and never silently upgraded:

| Fidelity | Meaning |
|---|---|
| `confirmed` | corroborated by a resolver, with a receipt + an evaluated check |
| `claimed` | asserted by one source (the default) |
| `guessed` | inferred — e.g. an induced cross-source edge. Real, but flagged |

## Consuming it — the SVM

The **Smoothie Virtual Machine** (`svm`) is a deterministic, model-free runtime.

```bash
svm validate <bc.json>                # provenance gates
svm bc show     --bc <bc.json>        # manifest, authorship, counts
svm query edges <id> --bc <bc.json>   # follow relationships
svm bc history                        # git-backed versioning + rollback
svm emit test --outline <id> --bc <bc.json> --mode read-only   # web-app only
```

### Safety

- **Inert data** — the SVM never executes anything embedded in the bytecode; an
  injection in a fact or `notice` is printed as data, never obeyed.
- **Read restrictions** — a node may be `restricted` (content withheld unless
  `--reveal`) or carry a `notice` (a warning surfaced on every read), enforced in code.
- **Execution floor (web-app)** — `emit` applies a deny-by-default floor; an embedded
  policy can only *tighten* it, never widen scope, unblock a destructive verb, raise a
  budget, or disable approval.

## Repository layout

| Path | What |
|---|---|
| `frontend/` | the producer — the `smoothie` CLI + pipeline (TypeScript, on Pi) |
| `svm/` | the consumer — the `svm` runtime (Rust) |
| `schema/` | the `bc.v1` contract (JSON Schema + TS types, mirrored by `svm`) |
| `skills/` | agent skills for driving the toolchain — `skills/smoothie/`, `skills/svm/` |

## Agent skills

Driving Smoothie from an agent? Load the bundled skills:

- **`skills/smoothie/`** — compiling data, authoring `smoothie_config.yaml`, tuning
  stages, the reader model, incremental compiles.
- **`skills/svm/`** — querying and traversing the bytecode, following receipts, the
  safety model, emit + versioning.

---

<div align="center">
<sub>Smoothie compiles your data into something an agent can trust — receipts and all.</sub>
</div>
