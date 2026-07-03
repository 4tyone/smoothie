# /// script
# requires-python = ">=3.10"
# dependencies = ["python-docx>=1.1"]
# ///
"""Extract a .docx's heading outline (the document's structure/TOC).

Usage: uv run structure.py <document.docx> [--json]
Output: {n_headings, outline:[{level, title}]}
"""
import argparse, json, sys


def outline(path) -> dict:
    import docx
    d = docx.Document(path)
    heads = []
    for p in d.paragraphs:
        style = (p.style.name or "") if p.style else ""
        if style.startswith("Heading") and p.text.strip():
            try:
                lvl = int(style.split()[-1])
            except Exception:
                lvl = 1
            heads.append({"level": lvl, "title": p.text.strip()})
        elif style == "Title" and p.text.strip():
            heads.append({"level": 0, "title": p.text.strip()})
    return {"n_headings": len(heads), "outline": heads}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("document")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = outline(args.document)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
