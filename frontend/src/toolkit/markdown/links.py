# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""Extract links, images, and YAML front-matter from a Markdown file.

Usage: uv run links.py <file.md> [--json]
Output: {frontmatter:{...}, n_links, links:[{text,href}], images:[{alt,src}]}
"""
import argparse, json, re, sys


def parse(path) -> dict:
    text = open(path, encoding="utf-8", errors="replace").read()
    fm = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if m:
        import yaml
        try:
            fm = yaml.safe_load(m.group(1)) or {}
        except Exception:
            fm = {}
        text = text[m.end():]
    images = [{"alt": a, "src": s} for a, s in re.findall(r"!\[([^\]]*)\]\(([^)]+)\)", text)]
    links = [{"text": t, "href": h} for t, h in re.findall(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)", text)]
    return {"frontmatter": fm, "n_links": len(links), "links": links, "n_images": len(images), "images": images}


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
