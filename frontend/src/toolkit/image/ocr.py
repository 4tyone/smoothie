# /// script
# requires-python = ">=3.10"
# dependencies = ["pytesseract>=0.3", "pillow>=10"]
# ///
"""OCR text from an image (tesseract). Requires the `tesseract` binary (system).

Usage: uv run ocr.py <image> [--lang eng] [--json]
Output: {n_chars, text, words:[{text,conf,bbox}]}
For semantic image understanding (captioning), let the model see the image directly;
this is for images that are primarily TEXT (screenshots, scans, slides).
"""
import argparse, json, sys


def ocr(path, lang) -> dict:
    import pytesseract
    from PIL import Image
    im = Image.open(path)
    text = pytesseract.image_to_string(im, lang=lang).strip()
    data = pytesseract.image_to_data(im, lang=lang, output_type=pytesseract.Output.DICT)
    words = []
    for i, w in enumerate(data["text"]):
        if w.strip() and int(data["conf"][i]) >= 0:
            words.append({"text": w, "conf": int(data["conf"][i]),
                          "bbox": [data["left"][i], data["top"][i], data["width"][i], data["height"][i]]})
    return {"n_chars": len(text), "text": text, "n_words": len(words), "words": words[:500]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image")
    ap.add_argument("--lang", default="eng")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = ocr(args.image, args.lang)
    except Exception as e:
        msg = str(e)
        if "tesseract" in msg.lower():
            msg += " — install the tesseract binary (e.g. `brew install tesseract`)."
        print(json.dumps({"error": msg, "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
