# Smoothie — agent guide

Smoothie is a **multimodal data compiler**. It compiles a folder of mixed files + a
Brief into one grounded, provenance-tracked **bytecode** (the BC; `bc.v1` JSON), which
a deterministic runtime serves to agents with no model in the loop.

**Two artifacts, one contract** (ADR-0001):
- `frontend/` — **`smoothie`**, the TypeScript producer CLI (runs on Pi / `@earendil-works/pi-ai`, ADR-0002). Pipeline: `ingest → describe → structure → link → resolve → compile`.
- `svm/` — **`svm`**, the Rust consumer runtime. Deterministic, no model: validate, query/traverse, versioned store, and (web-app profile) emit a guardrailed slice.
- `schema/` — `@smoothie/schema`, the `bc.v1` contract (JSON Schema + TS types), mirrored by the Rust serde types. **Defined once** — change all mirrors together.
- `skills/` — agent skills for driving the toolchain (`smoothie/`, `svm/`).

## Core principles

- **Grounded by construction.** Code materializes every receipt (`source_refs`); the
  model proposes facts, code binds them to the source. A processor/model can never forge
  a receipt or escalate fidelity (`confirmed` > `claimed` > `guessed`).
- **AI at the edges, deterministic core.** Only `describe`/`structure`/`link` call the
  model, behind a gateway. Everything else is code. Same input → same BC.
- **Safety is code, not prompts.** The BC is inert, untrusted data. The emit floor is
  deny-by-default and can only *tighten*; read restrictions and secret redaction are
  enforced in code.

## Build & test

```bash
cargo build --release            # → target/release/svm
cargo test --workspace           # SVM (Rust)
cd frontend && pnpm install
pnpm -C frontend typecheck && pnpm -C frontend test   # producer (tsc + vitest)
```

- The frontend e2e/golden tests consume a real `svm` binary — build it first.
- The **golden BC** (`frontend/test/fixtures/golden/bc.json`) is asserted byte-for-byte;
  any producer change must keep the deterministic path byte-identical.
- CI (`.github/workflows/ci.yml`) runs both halves + `--locked`/`--frozen-lockfile`.

## Run a compile

```bash
smoothie login                   # ChatGPT subscription (Codex OAuth) or set OPENAI_API_KEY
smoothie compile <folder>        # → <folder>/.smoothie/bc.json
svm query nodes --bc <folder>/.smoothie/bc.json
```

`<folder>` needs one `smoothie_config.yaml` (the Brief + runtime config).

## Hard constraints

1. **Model is `gpt-5.5`. Never change it.** (Reasoning model — needs `max_completion_tokens`.)
2. **Determinism path stays byte-identical** — the golden BC gates it.
3. **Contract enforced in CODE, not prompts** — receipts, fidelity clamps, the floor.
4. `describe` is the wall-clock bottleneck and fans out per-source (bounded pool;
   `SMOOTHIE_DESCRIBE_CONCURRENCY`, default 4). It is Brief-independent and **cached per
   source** by content hash — editing a source re-extracts only it.

## Where things live

- Pipeline stages: `frontend/src/stages/*.ts`. Model gateway: `frontend/src/model/`.
- Per-modality processors (bundled): `frontend/src/toolkit/<modality>/` (PEP 723 CLIs +
  `manifest.json` + `SKILL.md`, run via `uv`). Custom processors are declared in config.
- SVM: `svm/src/{bc,query,emit,policy,cache,storage}/`. Provenance gates: `svm/src/bc/validate.rs`.
- Design rationale (gitignored, on disk): `docs/specs/`, `docs/adr/`, `docs/PHASES.md`.
