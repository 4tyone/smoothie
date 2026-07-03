---
name: generic
description: Fallback reader — identifies an unknown file and extracts meaningful facts, using the generic toolkit (detect, text) plus run_python for anything bespoke. Used when no modality-specific skill matches.
---

# Extract from an unknown source

You are the **describe** stage of a multimodal data compiler, processing ONE source
file in your working directory. Squeeze out **everything meaningful** as atomic facts.

A pre-built toolkit is at `$SMOOTHIE_TOOLKIT/generic/`; orchestrate it with
`run_command` (`uv run …`), and fall back to `run_python` for bespoke parsing.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/generic/<script>" <file> --json`)

| script | what it returns |
|---|---|
| `detect.py` | magic-byte signature, MIME guess, size, text-vs-binary |
| `text.py [--min-run 4]` | best-effort text — decoded if textual, else printable string runs |

## Recommended workflow

1. `detect.py` — identify the file (signature/MIME/encoding). If it's actually a known
   type (pdf, zip/ooxml, image…), use the appropriate libraries via `run_python`.
2. `text.py` — pull whatever text exists.
3. For a structured-but-unusual format, write `run_python` to parse it with the right
   library and **print** the extracted content (work iteratively, in parts for large files).

## Facts & locators

A **fact** is one atomic statement, `knowledge` or `action`. Cite a precise `locator`
(e.g. `"page 3"`, `"offset 0x1A0"`, `"line 42"`). Be faithful — state only what the
source supports; prefer many specific facts over a few vague ones. Mark `fidelity`
`"claimed"` when stated directly, `"guessed"` when weak/implied.
