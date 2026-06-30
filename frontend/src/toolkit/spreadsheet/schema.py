# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "openpyxl>=3.1"]
# ///
"""Infer a tabular schema: columns, dtypes, and a dimension/measure split — the
analytical shape of a dataset, not a cell dump.

Usage: uv run schema.py <workbook|csv> [--sheet NAME] [--json]
Output: {n_rows, n_cols, dimensions:[...], measures:[...], columns:[{name,dtype,role,n_unique,n_null}]}
Heuristic: numeric (non-id, many distinct) → measure; else → dimension.
"""
import argparse, json, sys


def load(path, sheet):
    import pandas as pd
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet if sheet else 0)


def schema(path, sheet) -> dict:
    import pandas as pd
    df = load(path, sheet)
    n = len(df)
    cols, dims, meas = [], [], []
    for c in df.columns:
        s = df[c]
        nu = int(s.nunique(dropna=True))
        is_num = pd.api.types.is_numeric_dtype(s)
        is_id = nu == n and n > 0
        role = "measure" if (is_num and not is_id and nu > min(20, n * 0.5)) else "dimension"
        cols.append({"name": str(c), "dtype": str(s.dtype), "role": role,
                     "n_unique": nu, "n_null": int(s.isna().sum())})
        (meas if role == "measure" else dims).append(str(c))
    return {"n_rows": n, "n_cols": df.shape[1], "dimensions": dims, "measures": meas, "columns": cols}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook")
    ap.add_argument("--sheet", help="sheet name (default first)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = schema(args.workbook, args.sheet)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
