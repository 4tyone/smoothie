# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2", "openpyxl>=3.1"]
# ///
"""Group by a dimension and aggregate measures — the analysis the dataset supports
(e.g. total sales by segment). Sorted, top-N.

Usage: uv run aggregate.py <workbook|csv> --by Segment --measure Sales [--agg sum] [--top 20] [--sheet NAME]
   --by / --measure repeatable; --agg one of sum|mean|count|min|max (default sum)
Output: {by:[...], measures:[...], agg, n_groups, rows:[{<dims>, <measure>:value}]}
"""
import argparse, json, sys


def load(path, sheet):
    import pandas as pd
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path, sheet_name=sheet if sheet else 0)


def aggregate(path, sheet, by, measures, agg, top) -> dict:
    df = load(path, sheet)
    g = df.groupby(by)[measures].agg(agg).reset_index()
    sort_col = measures[0]
    g = g.sort_values(sort_col, ascending=False).head(top)
    rows = json.loads(g.to_json(orient="records", date_format="iso"))
    return {"by": by, "measures": measures, "agg": agg, "n_groups": len(rows), "rows": rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook")
    ap.add_argument("--by", action="append", required=True, help="dimension column (repeatable)")
    ap.add_argument("--measure", action="append", required=True, help="measure column (repeatable)")
    ap.add_argument("--agg", default="sum", help="sum|mean|count|min|max")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--sheet")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = aggregate(args.workbook, args.sheet, args.by, args.measure, args.agg, args.top)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
