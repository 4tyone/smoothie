# /// script
# requires-python = ">=3.10"
# dependencies = ["python-docx>=1.1"]
# ///
"""Extract tables from a .docx as rows.

Usage: uv run tables.py <document.docx> [--json]
Output: {n_tables, tables:[{index, n_rows, n_cols, rows:[[...]]}]}
"""
import argparse, json, sys


def tables(path) -> dict:
    import docx
    d = docx.Document(path)
    out = []
    for i, t in enumerate(d.tables):
        rows = [[c.text.strip() for c in r.cells] for r in t.rows]
        out.append({"index": i, "n_rows": len(rows), "n_cols": len(rows[0]) if rows else 0, "rows": rows})
    return {"n_tables": len(out), "tables": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("document")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = tables(args.document)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
