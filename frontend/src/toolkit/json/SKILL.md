---
name: json
description: Extracts schema, structure stats, and a flattened table from a JSON file by orchestrating the pre-built json toolkit (genson, pandas). Use for .json/.jsonl sources.
---

# Extract from JSON

The source JSON is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/json/`. **Orchestrate it with `run_command` (`uv run …`).** Use
`run_python` only for data-specific glue.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/json/<script>" <file> --json`)

| script | what it returns |
|---|---|
| `stats.py` | depth, type counts, top key frequencies, array sizes (stdlib; fast) |
| `schema.py [--lines]` | an inferred JSON Schema (the document's shape) |
| `flatten.py [--path a.b]` | flatten an array of objects into a profiled table |

## Recommended workflow

1. `stats.py` — get the shape (depth, keys, array sizes) cheaply.
2. `schema.py` — a precise schema (use `--lines` for JSON Lines).
3. If it's tabular (an array of records), `flatten.py --path <path-to-array>` to see
   columns + sample.

## Facts & locators

Produce facts about the schema, key entities/fields, and notable values. Cite
`locator: "<json path>"` (e.g. `"$.services[0]"`). Describe what's there.
