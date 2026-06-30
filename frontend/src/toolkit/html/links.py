# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4>=4.12", "lxml>=5"]
# ///
"""Extract links (and their anchor text) from an HTML file, split internal vs external.

Usage: uv run links.py <html> [--base https://site.com] [--json]
Output: {n_links, internal:[{href,text}], external:[{href,text}]}
"""
import argparse, json, sys
from urllib.parse import urlparse


def extract(path, base) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(open(path, encoding="utf-8", errors="replace").read(), "lxml")
    base_host = urlparse(base).netloc if base else None
    internal, external = [], []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        item = {"href": href, "text": a.get_text(strip=True)[:120]}
        host = urlparse(href).netloc
        if not host or (base_host and host == base_host):
            internal.append(item)
        else:
            external.append(item)
    return {"n_links": len(internal) + len(external),
            "internal": internal[:300], "external": external[:300]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("html")
    ap.add_argument("--base", help="base URL to classify internal vs external")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.html, args.base)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
