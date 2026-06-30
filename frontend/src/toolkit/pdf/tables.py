# /// script
# requires-python = ">=3.10"
# dependencies = ["pdfplumber>=0.11"]
# ///
"""Extract tables from a PDF with pdfplumber, page by page.

Usage: uv run tables.py <pdf> [--pages 1-12] [--json]
Output: {n_tables, tables:[{page, index, n_rows, n_cols, rows:[[...]]}]}
"""
import argparse, json, sys


def parse_pages(spec, n):
    if not spec:
        return range(n)
    if "-" in spec:
        a, b = spec.split("-"); return range(int(a) - 1, min(n, int(b)))
    return [int(spec) - 1]


def extract(path, spec) -> dict:
    import pdfplumber
    out = []
    with pdfplumber.open(path) as pdf:
        for i in parse_pages(spec, len(pdf.pages)):
            page = pdf.pages[i]
            for j, tbl in enumerate(page.extract_tables() or []):
                rows = [[(c or "").strip() for c in row] for row in tbl]
                out.append({"page": i + 1, "index": j,
                            "n_rows": len(rows), "n_cols": len(rows[0]) if rows else 0,
                            "rows": rows})
    return {"n_tables": len(out), "tables": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based range, e.g. 1-12")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.pdf, args.pages)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
