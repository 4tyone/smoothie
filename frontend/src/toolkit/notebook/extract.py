# /// script
# requires-python = ">=3.10"
# dependencies = ["nbformat>=5.9"]
# ///
"""Extract a Jupyter notebook into structured cells: markdown prose, code, and outputs
(text/stream/error; image outputs noted, not inlined).

Usage: uv run extract.py <notebook.ipynb> [--code-only] [--json]
Output: {n_cells, language, markdown_text, cells:[{index,type,source,outputs}]}
"""
import argparse, json, sys


def extract(path, code_only) -> dict:
    import nbformat
    nb = nbformat.read(path, as_version=4)
    lang = (nb.metadata.get("kernelspec", {}) or {}).get("language", "python")
    cells, md = [], []
    for i, c in enumerate(nb.cells):
        if code_only and c.cell_type != "code":
            continue
        item = {"index": i, "type": c.cell_type, "source": c.source}
        if c.cell_type == "markdown":
            md.append(c.source)
        if c.cell_type == "code":
            outs = []
            for o in c.get("outputs", []):
                if o.output_type == "stream":
                    outs.append({"kind": "stream", "text": o.get("text", "")[:2000]})
                elif o.output_type in ("execute_result", "display_data"):
                    data = o.get("data", {})
                    if "text/plain" in data:
                        outs.append({"kind": "result", "text": "".join(data["text/plain"])[:2000]})
                    if any(k.startswith("image/") for k in data):
                        outs.append({"kind": "image"})
                elif o.output_type == "error":
                    outs.append({"kind": "error", "ename": o.get("ename"), "evalue": o.get("evalue")})
            item["outputs"] = outs
        cells.append(item)
    return {"n_cells": len(cells), "language": lang,
            "markdown_text": "\n\n".join(md), "cells": cells}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("notebook")
    ap.add_argument("--code-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.notebook, args.code_only)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
