# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Probe an image → dimensions, mode, format, dominant colors, basic stats.

Usage: uv run probe.py <image> [--json]
Output: {width, height, mode, format, megapixels, aspect_ratio, dominant_colors}
"""
import argparse, json, sys


def probe(path: str) -> dict:
    from PIL import Image
    im = Image.open(path)
    w, h = im.size
    small = im.convert("RGB").resize((64, 64))
    colors = small.getcolors(64 * 64) or []
    colors.sort(reverse=True)
    dom = [{"rgb": list(c), "weight": round(n / (64 * 64), 3)} for n, c in colors[:5]]
    return {
        "width": w, "height": h, "mode": im.mode, "format": im.format,
        "megapixels": round(w * h / 1e6, 3),
        "aspect_ratio": round(w / h, 3) if h else None,
        "dominant_colors": dom,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = probe(args.image)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
