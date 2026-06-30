# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Identify an unknown file: magic-byte signature, MIME guess, size, text-vs-binary.
Stdlib only — the first move for an unrecognized modality.

Usage: uv run detect.py <file> [--json]
Output: {size_bytes, mime_guess, signature, is_text, encoding}
"""
import argparse, json, mimetypes, os, sys

SIGS = [
    (b"%PDF", "pdf"), (b"PK\x03\x04", "zip/office/ooxml"), (b"\x89PNG", "png"),
    (b"\xff\xd8\xff", "jpeg"), (b"GIF8", "gif"), (b"\x1f\x8b", "gzip"),
    (b"ID3", "mp3"), (b"OggS", "ogg"), (b"RIFF", "riff/wav/avi"),
    (b"\x00\x00\x00\x18ftyp", "mp4"), (b"\x00\x00\x00\x1cftyp", "mp4"),
    (b"SQLite format", "sqlite"), (b"{\n", "json?"), (b"<!DOCTYPE", "html"), (b"<html", "html"),
]


def detect(path) -> dict:
    size = os.path.getsize(path)
    head = open(path, "rb").read(512)
    sig = next((name for magic, name in SIGS if head.startswith(magic) or magic in head[:16]), None)
    is_text, enc = True, "utf-8"
    try:
        head.decode("utf-8")
    except UnicodeDecodeError:
        try:
            head.decode("latin-1"); enc = "latin-1"
        except Exception:
            is_text, enc = False, None
    # Binary heuristic: NUL bytes present.
    if b"\x00" in head:
        is_text = False
    return {"size_bytes": size, "mime_guess": mimetypes.guess_type(path)[0],
            "signature": sig, "is_text": is_text, "encoding": enc if is_text else None,
            "head_hex": head[:16].hex()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = detect(args.file)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
