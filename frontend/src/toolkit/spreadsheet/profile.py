# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "openpyxl>=3.1"]
# ///
"""Profile each column: nulls, uniques, numeric stats, top categorical values, and a
data-completeness score. The "what's actually in this dataset" report.

Usage: uv run profile.py <workbook|csv> [--sheet NAME] [--top 8] [--json]
Output: {n_rows, completeness, columns:[{name, n_null, n_unique, ...stats|top_values}]}
"""
import argparse, json, sys


def load(path, sheet):
    import pandas as pd
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet if sheet else 0)


def profile(path, sheet, top) -> dict:
    import pandas as pd
    df = load(path, sheet)
    n = len(df)
    cols = []
    for c in df.columns:
        s = df[c]
        info = {"name": str(c), "dtype": str(s.dtype),
                "n_null": int(s.isna().sum()), "n_unique": int(s.nunique(dropna=True))}
        if pd.api.types.is_numeric_dtype(s) and s.notna().any():
            d = s.describe()
            info["stats"] = {k: round(float(d[k]), 4) for k in ["mean", "std", "min", "25%", "50%", "75%", "max"] if k in d}
            info["sum"] = round(float(s.sum()), 4)
        else:
            vc = s.value_counts(dropna=True).head(top)
            info["top_values"] = [{"value": str(k), "count": int(v)} for k, v in vc.items()]
        cols.append(info)
    filled = int((df.notna().sum().sum()))
    completeness = round(filled / (n * df.shape[1]), 4) if n and df.shape[1] else 1.0
    return {"n_rows": n, "n_cols": df.shape[1], "completeness": completeness, "columns": cols}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook")
    ap.add_argument("--sheet")
    ap.add_argument("--top", type=int, default=8, help="top categorical values per column")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = profile(args.workbook, args.sheet, args.top)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
