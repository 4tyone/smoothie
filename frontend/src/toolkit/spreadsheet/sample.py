# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "openpyxl>=3.1"]
# ///
"""Sample rows from a sheet (head, or random) as records — see real values.

Usage: uv run sample.py <workbook|csv> [--n 5] [--random] [--sheet NAME] [--json]
Output: {n_rows, columns:[...], sample:[{...}]}
"""
import argparse, json, sys


def load(path, sheet):
    import pandas as pd
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet if sheet else 0)


def sample(path, sheet, n, rand) -> dict:
    df = load(path, sheet)
    s = df.sample(min(n, len(df)), random_state=0) if rand else df.head(n)
    return {"n_rows": len(df), "columns": [str(c) for c in df.columns],
            "sample": json.loads(s.to_json(orient="records", date_format="iso"))}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--random", action="store_true")
    ap.add_argument("--sheet")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = sample(args.workbook, args.sheet, args.n, args.random)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
