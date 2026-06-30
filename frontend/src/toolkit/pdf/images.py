# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf>=1.24"]
# ///
"""Extract embedded raster images from a PDF to a directory (for vision/figures).

Usage: uv run images.py <pdf> [--pages 1-12] [--min-bytes 4096] [--out images] [--json]
Output: {n_images, images:[{path, page, width, height}]}
"""
import argparse, json, os, sys


def parse_pages(spec, n):
    if not spec:
        return range(n)
    if "-" in spec:
        a, b = spec.split("-"); return range(int(a) - 1, min(n, int(b)))
    return [int(spec) - 1]


def extract(path, spec, out, min_bytes) -> dict:
    import fitz
    os.makedirs(out, exist_ok=True)
    doc = fitz.open(path)
    images, seen = [], set()
    for i in parse_pages(spec, doc.page_count):
        for img in doc[i].get_images(full=True):
            xref = img[0]
            if xref in seen:
                continue
            seen.add(xref)
            pix = fitz.Pixmap(doc, xref)
            if pix.n - pix.alpha >= 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            data = pix.tobytes("png")
            if len(data) < min_bytes:
                continue
            p = os.path.join(out, f"p{i+1:03d}_x{xref}.png")
            with open(p, "wb") as f:
                f.write(data)
            images.append({"path": p, "page": i + 1, "width": pix.width, "height": pix.height})
    return {"n_images": len(images), "images": images}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--pages", help="1-based range")
    ap.add_argument("--min-bytes", type=int, default=4096, help="skip tiny images (icons)")
    ap.add_argument("--out", default="images")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.pdf, args.pages, args.out, args.min_bytes)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
