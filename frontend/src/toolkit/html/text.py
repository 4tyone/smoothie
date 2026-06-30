# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4>=4.12", "lxml>=5", "html2text>=2024"]
# ///
"""Extract the main readable text from an HTML file as Markdown (boilerplate-stripped).

Usage: uv run text.py <html> [--json]
Output: {title, n_chars, markdown}
"""
import argparse, json, sys


def extract(path) -> dict:
    from bs4 import BeautifulSoup
    import html2text
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside"]):
        tag.decompose()
    title = (soup.title.string.strip() if soup.title and soup.title.string else None)
    main = soup.find("main") or soup.find("article") or soup.body or soup
    h = html2text.HTML2Text(); h.ignore_images = True; h.body_width = 0
    md = h.handle(str(main)).strip()
    return {"title": title, "n_chars": len(md), "markdown": md}


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
