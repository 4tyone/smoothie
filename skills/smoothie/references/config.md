# smoothie_config.yaml — full reference (`smoothie.config.v1`)

The required directive input. Schema-validated; an invalid file aborts `ingest`.
Top level has `version`, `profile`, `brief`, and optional `model` + `stages`.

## Top level

| Key | Required | Notes |
|---|---|---|
| `version` | yes | Must be `smoothie.config.v1`. Mirrors the bc.vN versioning discipline. |
| `profile` | yes | `corpus` (read-only knowledge) or `web-app` (operable UI map). Determines node vocabulary and whether `svm emit` works. |
| `brief` | yes | The Brief (below). |
| `model` | no | `{ default: "<provider/modelId>" }`. Omit to use your authenticated default. |
| `stages` | no | Per-stage `{ model?, thinking? }` (below). |
| `modalities` | no | Custom, named input modalities (spec 10). Keyed by custom name → `{ match, orchestration?, skill?, fetch?, processors[] }` (below). |
| `sources` | no | Remote / explicit inputs beyond folder-walking: `[{ uri, modality }]` (below). |

## `brief`

| Key | Required | Notes |
|---|---|---|
| `intent` | yes | One paragraph: what the BC is for. Becomes `brief.text`. |
| `goals` | yes (≥1) | `[{ id, text, done_when? }]`. **Each goal becomes a Brief-shaped outline** over the merged graph. |
| `scope` | no | `{ include?: [glob], exclude?: [glob], sources?: [{ path, note? }] }`. |
| `target` | no (web-app) | `{ base_url, allowed_origins: [..], start_paths: [..] }`. Feeds the policy scope floor. |
| `verify` | no | `{ resolve?: bool, resolvers?: [name], mode?: read-only\|dry-run\|live, credentials? }`. Drives the resolve stage. |
| `policy` | no (web-app) | `{ danger: [{ match, level: block\|approve\|supervise, reason }], budget: { max_actions?, max_pages? } }`. Seeds the BC policy — the SVM floor can only *tighten* it. |
| `glossary` | no | `[{ term, definition }]` → BC glossary. |
| `manifest` | no | `{ app_name?, author?, organization? }` → BC manifest/authorship. |

## `model` and `stages`

```yaml
model:
  default: openai-codex/gpt-5.5    # "provider/modelId" or just "modelId"
stages:
  describe:  { model?: ..., thinking: minimal }
  structure: { model?: ..., thinking: low }
  link:      { model?: ..., thinking: medium }
```

- `thinking` ∈ `minimal | low | medium | high` (Pi `ThinkingLevel`).
- **Defaults** (when a stage or field is omitted): describe `minimal`, structure
  `low`, link `medium`; model = `model.default` = your authenticated default.
- A stage's `model` overrides `model.default` for that stage only.
- Only `describe`, `structure`, `link` call the model; ingest/resolve/compile are
  code. `resolve`'s offline resolvers are deterministic.

## `modalities` and `sources` (custom input modalities, spec 10)

Pre-processing is open: a **modality** is user-defined and custom-named, and a
**processor** is any executable in any language. Smoothie owns only the `fact`
contract and the trust floor (code materializes every receipt); everything else is
declared here. Omit `modalities` entirely to use only the bundled processors.

Each `modalities.<name>` entry:

| Key | Required | Notes |
|---|---|---|
| `match` | yes | How sources match this modality: `{ ext?: [..], glob?: [..], mime?: [..], uri?: str \| [..] }`. Resolution order: config modalities (first match) → built-in extension map → `generic` (never silently skipped). |
| `orchestration` | no | `agent` (default) — the describe agent drives the processor's commands, guided by its skill; or `direct` — run the processor's `extract` command with no model. |
| `processors` | yes (≥1) | Each: `{ name, run? , path?, params? }`. `run` is an inline shell template; `path` points at a package dir (CLI + `SKILL.md` + `manifest.json`). `params` (`{ <name>: { type?, default?, description? } }`) are exposed to the command as `$<name>` and `SMOOTHIE_PARAM_<NAME>`. |
| `skill` | no | Path to a `SKILL.md` override. Skill precedence: processor-bundled → this override → project `.smoothie/skills/<modality>/` → bundled → `generic`. |
| `fetch` | no | `{ run: "<shell>" }` — localizes a remote source into `$SMOOTHIE_WORKDIR` before processing. |

A processor is invoked with the **source descriptor** in its environment:
`SMOOTHIE_SOURCE_PATH`, `SMOOTHIE_SOURCE_URI`, `SMOOTHIE_SOURCE_ID`,
`SMOOTHIE_SOURCE_BASENAME`, `SMOOTHIE_MODALITY`, `SMOOTHIE_WORKDIR`,
`SMOOTHIE_TOOLKIT`, `SMOOTHIE_PROCESSOR_DIR` (for `path` packages), `SMOOTHIE_PARAMS`,
and `SMOOTHIE_BRIEF`. A `direct`/`extract` command prints one `smoothie.extraction.v1`
fact bundle to stdout; validate with `smoothie preprocess --check <folder>`.

`sources` (optional) declares explicit/remote inputs beyond folder-walking:
`[{ uri, modality }]`. The named modality's `fetch` localizes each one.

```yaml
modalities:
  cad:
    match: { ext: [dwg, dxf] }
    orchestration: direct                 # no model; take the processor's facts
    processors:
      - { name: read, run: './bin/cad-reader "$SMOOTHIE_SOURCE_PATH"' }   # any language
  s3-exports:
    match: { uri: 's3://acme-exports/**' }
    fetch: { run: 'aws s3 cp "$SMOOTHIE_SOURCE_URI" "$SMOOTHIE_WORKDIR/$SMOOTHIE_SOURCE_BASENAME"' }
    processors:
      - { name: analyze, run: 'node analyze.js "$SMOOTHIE_SOURCE_PATH"' }
sources:
  - { uri: 's3://acme-exports/2026/**/*.csv', modality: s3-exports }
```

## Two worked examples

**Corpus (knowledge base):**
```yaml
version: smoothie.config.v1
profile: corpus
brief:
  intent: Compile the finance guides + sample dataset into one queryable knowledge base.
  goals:
    - { id: understand, text: explain how to read a company's core statements }
    - { id: sales-data, text: summarize what the sample dataset contains }
```

**Web-app (operable map) with a danger policy:**
```yaml
version: smoothie.config.v1
profile: web-app
brief:
  intent: Map the billing app's dunning flow into an operable bytecode.
  goals:
    - { id: dunning, text: explain and operate the failed-payment retry, done_when: a past-due invoice is retried and marked paid }
  target: { base_url: https://app.example.com, allowed_origins: [https://app.example.com] }
  policy:
    danger:
      - { match: "delete *", level: block, reason: deletions need a human }
    budget: { max_actions: 50 }
  manifest: { app_name: Example Billing }
stages:
  link: { thinking: high }   # spend more on cross-source synthesis
```

## `.smoothieignore`

A gitignore-style file in the data folder. `smoothie_config.yaml` and `.smoothie/`
are **always** ignored as sources; add more patterns (one per line; trailing `/` =
directory prefix; `*` = wildcard; `#` comments). Example:

```
reports/
*.tmp
scratch/
```
