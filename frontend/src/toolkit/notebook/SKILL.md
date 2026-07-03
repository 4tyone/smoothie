---
name: notebook
description: Extracts prose, code, and outputs from a Jupyter notebook by orchestrating the pre-built notebook toolkit (nbformat). Use for .ipynb sources.
---

# Extract from a Jupyter notebook

The source notebook is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/notebook/`. **Orchestrate it with `run_command` (`uv run …`).**

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/notebook/<script>" <notebook> --json`)

| script | what it returns |
|---|---|
| `extract.py` | `{cells:[{index,type,source,outputs}], language, markdown_text}` |
| `extract.py --code-only` | just the code cells (skip prose) |

## Recommended workflow

1. `extract.py` — the full notebook: markdown prose, code, and text/result/error outputs
   (image outputs are noted, not inlined).
2. Read the `markdown_text` for the narrative; read code + outputs for what it computes.

## Facts & locators

Produce facts about the analysis: its purpose, key computations, and conclusions
(from prose + outputs). Cite `locator: "cell N (<type>)"`. Report results as shown.
