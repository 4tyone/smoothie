---
name: spreadsheet
description: Extracts the analytical shape of a spreadsheet — schema, dimensions vs measures, per-column profile, and grouped aggregates — by orchestrating the pre-built spreadsheet toolkit (pandas). Use for .xlsx/.xls/.csv/.ods sources.
---

# Extract from a spreadsheet

The source workbook is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/spreadsheet/`. **Orchestrate it with `run_command` (`uv run …`) —
do not write pandas extraction from scratch.** Use `run_python` only for
data-specific glue (a custom pivot the toolkit doesn't cover).

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/spreadsheet/<script>" <file> --json`)

| script | what it returns |
|---|---|
| `sheets.py` | every sheet with shape + header preview (start here) |
| `schema.py [--sheet S]` | columns, dtypes, and a **dimension/measure split** |
| `profile.py [--sheet S]` | per-column nulls, uniques, numeric stats, top values, completeness |
| `aggregate.py --by DIM --measure M [--agg sum]` | grouped aggregate (e.g. total sales by segment) |
| `sample.py [--n 5] [--random]` | real sample rows as records |

## Recommended workflow

1. `sheets.py` — sheet names + shapes.
2. `schema.py` — the dimension/measure split (the dataset's analytical shape).
3. `profile.py` — distributions, null counts, data completeness.
4. `aggregate.py --by <dimension> --measure <measure>` for the key analyses the data
   supports (e.g. `--by Segment --measure Sales`). Run a few telling ones.
5. `sample.py` to ground a few real rows.

## Facts & locators

Produce facts about: what the dataset is, each dimension and its values, each measure
and its range/total, data quality (nulls/completeness), and the notable analyses
(e.g. "Government has the highest total sales"). Cite `locator: "Sheet '<name>'"` or
`"Sheet '<name>' grouped by '<dim>'"`. Report figures faithfully; don't round away meaning.
