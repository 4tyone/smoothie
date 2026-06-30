# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Parse GitHub-flavored Markdown tables into structured rows. Stdlib only.

Usage: uv run tables.py <file.md> [--json]
Output: {n_tables, tables:[{header:[...], rows:[{...}]}]}
"""
import argparse, json, re, sys


def split_row(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse(path) -> dict:
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    tables, i = [], 0
    sep = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$")
    while i < len(lines):
        if "|" in lines[i] and i + 1 < len(lines) and sep.match(lines[i + 1]):
            header = split_row(lines[i]); i += 2; rows = []
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                cells = split_row(lines[i])
                rows.append({header[j] if j < len(header) else f"col{j}": cells[j]
                             for j in range(len(cells))})
                i += 1
            tables.append({"header": header, "n_rows": len(rows), "rows": rows})
        else:
            i += 1
    return {"n_tables": len(tables), "tables": tables}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = parse(args.file)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
