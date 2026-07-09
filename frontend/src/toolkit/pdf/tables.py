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
    # Accept a single page (N), a range (A-B), or a comma list mixing both
    # (e.g. "2,5,9" or "1-3,7"). 1-based on input, 0-based on output.
    if not spec:
        return range(n)
    out, seen = [], set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            rng = range(int(a) - 1, min(n, int(b)))
        else:
            p = int(part) - 1
            rng = [p] if 0 <= p < n else []
        for p in rng:
            if p not in seen:
                seen.add(p); out.append(p)
    return out


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
