# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24"]
# ///
"""Probe a PDF → page count, metadata, per-page text coverage (detect scanned pages).

Usage: uv run probe.py <pdf> [--json]
Output: {n_pages, metadata, has_text, scanned_pages:[...], toc:[...]}
A page with ~no extractable text is likely scanned → use ocr.py for it.
"""
import argparse, json, sys


def probe(path: str) -> dict:
    import fitz
    doc = fitz.open(path)
    scanned, total_chars = [], 0
    for i, page in enumerate(doc):
        n = len(page.get_text("text").strip())
        total_chars += n
        if n < 20:
            scanned.append(i + 1)
    toc = [{"level": lvl, "title": t, "page": p} for lvl, t, p in doc.get_toc()]
    return {
        "n_pages": doc.page_count,
        "metadata": {k: v for k, v in doc.metadata.items() if v},
        "total_text_chars": total_chars,
        "has_text": total_chars > 50,
        "scanned_pages": scanned,
        "n_toc_entries": len(toc),
        "toc": toc[:200],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = probe(args.pdf)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
