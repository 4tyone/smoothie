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
  intent: Map the billing app's dunning flow into an operable cartridge.
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
