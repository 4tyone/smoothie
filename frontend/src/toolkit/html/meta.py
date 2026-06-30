# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4>=4.12", "lxml>=5"]
# ///
"""Extract metadata from HTML: <title>, meta description/keywords, OpenGraph, headings.

Usage: uv run meta.py <html> [--json]
Output: {title, description, og:{...}, headings:[{level,text}]}
"""
import argparse, json, sys


def extract(path) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(open(path, encoding="utf-8", errors="replace").read(), "lxml")
    meta = {m.get("name", "").lower(): m.get("content") for m in soup.find_all("meta") if m.get("name")}
    og = {m.get("property")[3:]: m.get("content") for m in soup.find_all("meta")
          if (m.get("property") or "").startswith("og:")}
    heads = [{"level": int(h.name[1]), "text": h.get_text(strip=True)}
             for h in soup.find_all(["h1", "h2", "h3", "h4"]) if h.get_text(strip=True)]
    return {
        "title": (soup.title.string.strip() if soup.title and soup.title.string else None),
        "description": meta.get("description"),
        "keywords": meta.get("keywords"),
        "author": meta.get("author"),
        "og": og,
        "n_headings": len(heads),
        "headings": heads[:100],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("html")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.html)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
