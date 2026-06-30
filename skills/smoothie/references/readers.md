# Readers — a per-modality toolkit the agent orchestrates

Smoothie has **no fixed parsers**. In `describe`, the model runs as a tool-calling
agent that **orchestrates a pre-built, per-modality toolkit** of Python scripts (and
writes Python only for data-specific glue), guided by a **per-modality skill**. This
is why a spreadsheet yields a real analytical schema (dimensions vs measures,
data-quality checks) instead of a cell dump, and a video yields sentiment-tagged
timestamp ranges with extracted frames.

## How it runs

1. `ingest` classifies the file's modality from its extension.
2. `describe` scaffolds the bundled toolkit into `.smoothie/tools/<modality>/`, loads
   the matching reader skill, copies the source into `.smoothie/work/<source_id>/`,
   and gives the agent two tools (cwd = that workdir, `$SMOOTHIE_TOOLKIT` = the tools dir):
   - **`run_command`** — runs a toolkit script via `uv run "$SMOOTHIE_TOOLKIT/<modality>/<script>.py" <args> --json` (or ffmpeg/ffprobe). This is the primary path.
   - **`run_python`** — ad-hoc Python for glue the toolkit doesn't cover (shared data venv).
3. The agent returns facts, each with a `locator` (page/sheet/timestamp/region).
   **Code** turns the locator into a provenance span — the receipt points at real evidence.
4. The Python it ran and any artifacts (frames, extracted images) stay in
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

- **Skills** (the agent's per-modality instructions, Agent-Skills `SKILL.md`):
  discovered at `.smoothie/skills/<modality>/SKILL.md` (project override) → bundled →
  `generic`. `smoothie skills install <folder>` copies the bundled skills **and** the
  toolkit into `.smoothie/` so you can edit either.
- **Toolkit scripts**: the bundled toolkit is canonical and re-scaffolded each compile;
  the agent forks a script into its workdir for data-specific tweaks rather than
  editing the shared copy. Add your own `tools/<modality>/*.py` (new filenames survive).

## Determinism note

The real reader is non-deterministic (it's an agent orchestrating tools). For "same
input → same BC" tests, `--deterministic` swaps in a text-splitter gateway — CI-only,
never real extraction.
