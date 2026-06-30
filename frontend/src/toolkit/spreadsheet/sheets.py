# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "openpyxl>=3.1"]
# ///
"""List a workbook's sheets with shape + header preview. Start here for an .xlsx/.xls.

Usage: uv run sheets.py <workbook> [--json]
Output: {n_sheets, sheets:[{name, n_rows, n_cols, columns:[...]}]}
For .csv there's one implicit sheet; the other scripts accept .csv too.
"""
import argparse, json, sys


def sheets(path: str) -> dict:
    import pandas as pd
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path, nrows=5)
        full = pd.read_csv(path, usecols=[0])
        return {"n_sheets": 1, "sheets": [{"name": "csv", "n_rows": len(full),
                "n_cols": df.shape[1], "columns": [str(c) for c in df.columns]}]}
    xl = pd.ExcelFile(path)
    out = []
    for name in xl.sheet_names:
        df = xl.parse(name, nrows=5)
        full = xl.parse(name, usecols=[0]) if df.shape[1] else df
        out.append({"name": name, "n_rows": len(full), "n_cols": df.shape[1],
                    "columns": [str(c) for c in df.columns]})
    return {"n_sheets": len(out), "sheets": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = sheets(args.workbook)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
