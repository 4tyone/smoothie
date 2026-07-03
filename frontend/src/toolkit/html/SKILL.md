---
name: html
description: Extracts main text, tables, links, and metadata from HTML by orchestrating the pre-built html toolkit (BeautifulSoup, html2text, pandas). Use for .html/.htm sources.
---

# Extract from HTML

The source HTML is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/html/`. **Orchestrate it with `run_command` (`uv run …`) — do not
write BeautifulSoup code from scratch.** Use `run_python` only for glue.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/html/<script>" <html> --json`)

| script | what it returns |
|---|---|
| `meta.py` | title, description, OpenGraph, heading outline |
| `text.py` | main readable text as Markdown (boilerplate stripped) |
| `tables.py` | every `<table>` as structured rows |
| `links.py [--base URL]` | links split internal vs external |

## Recommended workflow

1. `meta.py` — title, description, headings (the page's shape).
2. `text.py` — the main content.
3. `tables.py` if the page has data tables.
4. `links.py` if the link graph matters.

## Facts & locators

Produce a fact per section and per table. Cite `locator: "section: <heading>"`.
Extract what's present; don't invent.
