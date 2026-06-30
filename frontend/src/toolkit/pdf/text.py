# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24"]
# ///
"""Extract per-page text from a PDF (layout-aware), with page locators for receipts.

Usage: uv run text.py <pdf> [--pages 1-12] [--blocks] [--json]
Output: {n_pages, pages:[{page, text, n_chars}]}
--pages selects a 1-based range (e.g. 1-12 or 3). --blocks returns layout blocks
with bounding boxes instead of flat text.
"""
import argparse, json, sys


def parse_pages(spec, n):
    if not spec:
        return range(n)
    if "-" in spec:
        a, b = spec.split("-"); return range(int(a) - 1, min(n, int(b)))
    return [int(spec) - 1]


def extract(path, spec, blocks) -> dict:
    import fitz
    doc = fitz.open(path)
    pages = []
    for i in parse_pages(spec, doc.page_count):
        page = doc[i]
        if blocks:
            bl = [{"bbox": [round(x, 1) for x in b[:4]], "text": b[4].strip()}
                  for b in page.get_text("blocks") if b[4].strip()]
            pages.append({"page": i + 1, "n_blocks": len(bl), "blocks": bl})
        else:
            t = page.get_text("text").strip()
            pages.append({"page": i + 1, "n_chars": len(t), "text": t})
    return {"n_pages": doc.page_count, "returned_pages": len(pages), "pages": pages}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based range, e.g. 1-12 or 5")
    ap.add_argument("--blocks", action="store_true", help="layout blocks with bboxes")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.pdf, args.pages, args.blocks)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
