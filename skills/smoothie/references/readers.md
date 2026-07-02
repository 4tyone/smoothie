# Processors — the open, language-agnostic input contract

Smoothie has **no fixed parsers**. Each source is matched to a **modality**
(config-declared and custom-named, or built-in) backed by a **processor** - any
executable in any language. Smoothie owns only the `fact` contract and the trust
floor (code materializes every receipt); how a source becomes text/facts is the
processor's business. The bundled per-modality Python toolkit is just the **built-in
processor set** - a first-class citizen of this same contract, with no privileged
path. This is why a spreadsheet yields a real analytical schema (dimensions vs
measures, data-quality checks) instead of a cell dump, and a video yields
sentiment-tagged timestamp ranges with extracted frames.

Declare custom modalities in `smoothie_config.yaml` (`modalities` + remote `sources`);
see [config.md](config.md). Dry-run resolution with `smoothie preprocess --check <folder>`.

## How it runs

1. `ingest` resolves each source to a modality: config `modalities` (first matching
   `ext`/`glob`/`mime`/`uri`) → the built-in extension map → `generic` (never silently
   skipped). A remote source declared in `sources` is localized first via its
   modality's `fetch`.
2. `describe` resolves the processor for that modality and runs it in one of two modes:
   - **`agent`** (default) — copies the source into `.smoothie/work/<source_id>/`,
     loads the processor's skill, and lets the model drive the processor's commands
     (via `run_command`, cwd = the workdir, the `SMOOTHIE_*` descriptor in the env),
     plus `run_python` for glue. Built-in processors run their toolkit via
     `uv run "$SMOOTHIE_TOOLKIT/<modality>/<script>.py" <args> --json`.
   - **`direct`** — runs the processor's `extract` command with no model; it prints a
     `smoothie.extraction.v1` fact bundle that code validates.
3. Facts carry a `locator` (page/sheet/timestamp/region) or a structured `span`;
   **code** turns it into the provenance receipt, bound to the real source.
4. Whatever the processor/agent ran and any artifacts (frames, companions) stay in
   `.smoothie/work/<source>/` for inspection (gitignored).

## uv for dependency separation (lazy, local, isolated)

Each toolkit script is a **self-contained CLI with PEP 723 inline dependencies** (a
`# /// script` header listing its deps). `uv run <script>` provisions an **isolated,
cached environment per script's dependency set** — installed **on first use** (lazy,
fully local/offline) and **separated by modality**, so the heavy video stack
(faster-whisper) never bloats the light JSON/Markdown scripts. No shared mega-venv.
uv is required (already used to provision the ad-hoc `run_python` venv).

## Modalities & toolkits

`pdf`, `spreadsheet`, `markdown`, `docs`, `html`, `json`, `notebook`, `image`,
`video`, `audio`, and `generic` (fallback). Each `tools/<modality>/` has several
focused scripts — run `uv run <script> --help` to see options. Examples:

- **video**: `probe`, `transcribe`, `sentiment_segments`, `scene_detect`, `extract_frames`, `keyframes`
- **pdf**: `probe`, `text`, `tables`, `images`, `ocr`
- **spreadsheet**: `sheets`, `schema` (dimension/measure split), `profile`, `aggregate`, `sample`
- **audio**: `probe`, `transcribe`, `sentiment_segments`, `segment_silence`
- **image**: `probe`, `ocr`, `exif` · **html**: `text`, `tables`, `links`, `meta`
- **json**: `schema`, `stats`, `flatten` · **markdown**: `structure`, `tables`, `links`
- **docs**: `text`, `tables`, `structure` · **notebook**: `extract` · **generic**: `detect`, `text`

## Customizing

- **Custom modalities** (any language): declare `modalities.<name>` in
  `smoothie_config.yaml` with a matcher + processor(s) (`run` inline, or a package
  `path` with a CLI + `SKILL.md` + `manifest.json`), plus optional `fetch` (remote)
  and `skill`. Choose `orchestration: agent` (default) or `direct`. See
  [config.md](config.md).
- **Skills** (the agent's per-modality instructions, Agent-Skills `SKILL.md`):
  precedence is processor-bundled → `.smoothie/skills/<modality>/SKILL.md` (project
  override) → bundled → `generic`. `smoothie skills install <folder>` copies the
  bundled skills **and** the toolkit into `.smoothie/` so you can edit either.
- **Toolkit scripts** (built-in processors): the bundled toolkit is canonical and
  re-scaffolded each compile; the agent forks a script into its workdir for
  data-specific tweaks rather than editing the shared copy. Add your own
  `tools/<modality>/*.py` (new filenames survive).

## Determinism note

The real reader is non-deterministic (it's an agent orchestrating tools). For "same
input → same BC" tests, `--deterministic` swaps in a text-splitter gateway — CI-only,
never real extraction.
