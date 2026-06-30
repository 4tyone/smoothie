# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "lxml>=5", "beautifulsoup4>=4.12"]
# ///
"""Extract every HTML <table> as structured rows (pandas.read_html).

Usage: uv run tables.py <html> [--json]
Output: {n_tables, tables:[{index, n_rows, n_cols, columns, rows:[{...}]}]}
"""
import argparse, json, sys


def extract(path) -> dict:
    import pandas as pd
    dfs = pd.read_html(path)
    out = []
    for i, df in enumerate(dfs):
        out.append({"index": i, "n_rows": len(df), "n_cols": df.shape[1],
                    "columns": [str(c) for c in df.columns],
                    "rows": json.loads(df.head(200).to_json(orient="records", date_format="iso"))})
    return {"n_tables": len(out), "tables": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("html")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.html)
    except ValueError:
        result = {"n_tables": 0, "tables": []}  # read_html raises if no tables
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
