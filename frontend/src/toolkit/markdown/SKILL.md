---
name: markdown
description: Extracts section structure, tables, links, and front-matter from a Markdown document by orchestrating the pre-built markdown toolkit (stdlib + pyyaml). Use for .md/.markdown sources.
---

# Extract from Markdown

The source `.md` is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/markdown/`. **Orchestrate it with `run_command` (`uv run …`).**

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/markdown/<script>" <file> --json`)

| script | what it returns |
|---|---|
| `structure.py` | heading outline + each section's body (fenced code ignored) |
| `tables.py` | GFM tables as structured rows |
| `links.py` | links, images, and YAML front-matter |

## Recommended workflow

1. `structure.py` — the section outline + bodies (the backbone).
2. `tables.py` if there are tables.
3. `links.py` for front-matter metadata and references.

## Facts & locators

Produce a fact per section's content — `knowledge`, and `action` facts when a section
describes a step (click/navigate/run). Cite `locator: "section: <heading>"`.
