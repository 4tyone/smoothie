# /// script
# requires-python = ">=3.10"
# dependencies = ["genson>=1.2"]
# ///
"""Infer a JSON Schema from a JSON (or JSON-Lines) file — the shape of the data.

Usage: uv run schema.py <file.json> [--lines] [--json]
  --lines: treat the file as JSON Lines (one object per line).
Output: a JSON Schema (draft) describing the document.
"""
import argparse, json, sys


def infer(path, lines) -> dict:
    from genson import SchemaBuilder
    b = SchemaBuilder()
    if lines:
        for ln in open(path):
            ln = ln.strip()
            if ln:
                b.add_object(json.loads(ln))
    else:
        b.add_object(json.load(open(path)))
    return b.to_schema()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--lines", action="store_true", help="JSON Lines input")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = infer(args.file, args.lines)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
