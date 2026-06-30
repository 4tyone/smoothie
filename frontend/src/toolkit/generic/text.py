# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Best-effort text extraction from an unknown file: decode if textual, else pull
printable ASCII strings (like `strings`). Stdlib only.

Usage: uv run text.py <file> [--min-run 4] [--max-bytes 5000000] [--json]
Output: {mode, n_chars, text}  (mode = "decoded" | "strings")
"""
import argparse, json, re, sys


def extract(path, min_run, max_bytes) -> dict:
    raw = open(path, "rb").read(max_bytes)
    if b"\x00" not in raw[:1024]:
        for enc in ("utf-8", "latin-1"):
            try:
                t = raw.decode(enc)
                return {"mode": "decoded", "encoding": enc, "n_chars": len(t), "text": t}
            except UnicodeDecodeError:
                continue
    # Binary → printable string runs.
    runs = re.findall(rb"[\x20-\x7e]{%d,}" % min_run, raw)
    text = "\n".join(r.decode("ascii") for r in runs)
    return {"mode": "strings", "n_strings": len(runs), "n_chars": len(text), "text": text}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--min-run", type=int, default=4, help="min printable run length for strings mode")
    ap.add_argument("--max-bytes", type=int, default=5_000_000)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.file, args.min_run, args.max_bytes)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
