# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Parse a Markdown file's heading outline and section bodies (fenced code ignored).

Usage: uv run structure.py <file.md> [--json]
Output: {n_headings, outline:[{level,title}], sections:[{level,title,body}]}
"""
import argparse, json, re, sys


def parse(path) -> dict:
    text = open(path, encoding="utf-8", errors="replace").read()
    lines = text.split("\n")
    outline, sections, cur, in_fence = [], [], None, False
    for ln in lines:
        if ln.strip().startswith("```"):
            in_fence = not in_fence
        m = re.match(r"^(#{1,6})\s+(.*)$", ln) if not in_fence else None
        if m:
            if cur:
                cur["body"] = "\n".join(cur["_b"]).strip(); del cur["_b"]; sections.append(cur)
            lvl, title = len(m.group(1)), m.group(2).strip()
            outline.append({"level": lvl, "title": title})
            cur = {"level": lvl, "title": title, "_b": []}
        elif cur:
            cur["_b"].append(ln)
    if cur:
        cur["body"] = "\n".join(cur["_b"]).strip(); del cur["_b"]; sections.append(cur)
    return {"n_headings": len(outline), "outline": outline, "sections": sections}


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
