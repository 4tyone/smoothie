---
name: pdf
description: Extracts text, tables, structure, images, and OCR from a PDF by orchestrating the pre-built pdf toolkit (PyMuPDF, pdfplumber, tesseract). Use for .pdf sources, including scanned ones.
---

# Extract from a PDF

The source PDF is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/pdf/`. **Orchestrate it with `run_command` (`uv run …`) — do not
write extraction code from scratch.** Use `run_python` only for data-specific glue.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/pdf/<script>" <pdf> --json`)

| script | what it returns |
|---|---|
| `probe.py` | page count, metadata, TOC, and **which pages look scanned** |
| `text.py [--pages 1-12] [--blocks]` | per-page text (or layout blocks with bboxes) |
| `tables.py [--pages 1-12]` | tables as rows, by page (financial docs are table-heavy) |
| `images.py [--pages 1-12]` | embedded figures written to a dir, for vision |
| `ocr.py --pages 1-3` | OCR for scanned pages (needs system `tesseract`) |

## Recommended workflow

1. `probe.py` — page count, TOC, scanned pages. Plan from the TOC.
2. `text.py` over the whole document (`--pages 1-12`, then the next range) — read it
   in large ranges, not page by page.
3. `tables.py` for the pages that have tables — list columns and key figures as facts.
4. For pages `probe.py` flagged as scanned, `ocr.py --pages <those>`.
5. `images.py` if figures/charts matter (then reason over them with vision).

## Facts & locators

Be comprehensive: a fact for the document's purpose, each major section/topic, and
each table's meaning + key figures. Capture any named standards/identifiers verbatim.
Cite `locator: "page N"` (and section when known). Never fabricate; flag genuinely
missing content as a gap (`fidelity: "guessed"`).
