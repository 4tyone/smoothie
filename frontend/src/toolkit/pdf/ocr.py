# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24", "pytesseract>=0.3", "pillow>=10"]
# ///
"""OCR scanned PDF pages (rasterize → tesseract). Use for pages probe.py flags as
scanned. Requires the `tesseract` binary (system); reports clearly if it's missing.

Usage: uv run ocr.py <pdf> [--pages 1-3] [--dpi 300] [--lang eng] [--json]
Output: {pages:[{page, text, n_chars}]}
"""
import argparse, json, sys


def parse_pages(spec, n):
    if not spec:
        return range(n)
    if "-" in spec:
        a, b = spec.split("-"); return range(int(a) - 1, min(n, int(b)))
    return [int(spec) - 1]


def ocr(path, spec, dpi, lang) -> dict:
    import fitz, pytesseract
    from PIL import Image
    import io
    doc = fitz.open(path)
    pages = []
    for i in parse_pages(spec, doc.page_count):
        pix = doc[i].get_pixmap(dpi=dpi)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img, lang=lang).strip()
        pages.append({"page": i + 1, "n_chars": len(text), "text": text})
    return {"returned_pages": len(pages), "pages": pages}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based range (OCR is slow — scope it)")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--lang", default="eng")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = ocr(args.pdf, args.pages, args.dpi, args.lang)
    except Exception as e:
        msg = str(e)
        if "tesseract" in msg.lower():
            msg += " — install the tesseract binary (e.g. `brew install tesseract`)."
        print(json.dumps({"error": msg, "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
