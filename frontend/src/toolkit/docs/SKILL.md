---
name: docs
description: Extracts text, headings, and tables from Office documents by orchestrating the pre-built docs toolkit (python-docx, python-pptx, odfpy). Use for .docx/.pptx/.odt sources.
---

# Extract from an Office document

The source document is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/docs/`. **Orchestrate it with `run_command` (`uv run …`) — do not
write parsing code from scratch.** Use `run_python` only for glue.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/docs/<script>" <document> --json`)

| script | what it returns |
|---|---|
| `text.py` | full text — `.docx` paragraphs, `.pptx` per-slide, `.odt` paragraphs |
| `tables.py` | tables as rows (`.docx`) |
| `structure.py` | heading outline / TOC (`.docx`) |

## Recommended workflow

1. `structure.py` (docx) — the outline, to plan coverage.
2. `text.py` — the body (or per-slide text for pptx).
3. `tables.py` — any tables, with columns and key figures.

## Facts & locators

Produce a fact per section/slide and per table. Cite `locator: "section: <heading>"`
or `"slide N"`. Don't fabricate; if a format isn't supported, note the gap.
