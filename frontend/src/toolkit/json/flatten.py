# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2"]
# ///
"""Flatten a JSON array of objects (or a path into one) into a table, then profile it
— turns nested JSON into tabular records with dotted column names.

Usage: uv run flatten.py <file.json> [--path records.items] [--sample 5] [--json]
Output: {n_rows, columns:[...], dtypes:{...}, sample:[{...}]}
"""
import argparse, json, sys


def dig(data, path):
    if not path:
        return data
    for key in path.split("."):
        data = data[int(key)] if key.isdigit() else data[key]
    return data


def flatten(path, jpath, sample) -> dict:
    import pandas as pd
    data = dig(json.load(open(path)), jpath)
    if not isinstance(data, list):
        data = [data]
    df = pd.json_normalize(data)
    return {"n_rows": len(df), "n_cols": df.shape[1],
            "columns": [str(c) for c in df.columns],
            "dtypes": {str(c): str(t) for c, t in df.dtypes.items()},
            "sample": json.loads(df.head(sample).to_json(orient="records", date_format="iso"))}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--path", default="", help="dotted path to the array (e.g. data.rows)")
    ap.add_argument("--sample", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = flatten(args.file, args.path, args.sample)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
