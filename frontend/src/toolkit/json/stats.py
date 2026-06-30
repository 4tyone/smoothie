# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Structural stats for a JSON file: depth, type counts, key frequencies, array sizes.
Stdlib only — fast even on large files.

Usage: uv run stats.py <file.json> [--json]
Output: {root_type, max_depth, n_nodes, type_counts, top_keys, array_lengths}
"""
import argparse, json, sys
from collections import Counter


def walk(node, depth, st):
    st["n_nodes"] += 1
    st["max_depth"] = max(st["max_depth"], depth)
    t = type(node).__name__
    st["types"][t] += 1
    if isinstance(node, dict):
        for k, v in node.items():
            st["keys"][k] += 1
            walk(v, depth + 1, st)
    elif isinstance(node, list):
        st["array_lengths"].append(len(node))
        for v in node:
            walk(v, depth + 1, st)


def stats(path) -> dict:
    data = json.load(open(path))
    st = {"n_nodes": 0, "max_depth": 0, "types": Counter(), "keys": Counter(), "array_lengths": []}
    walk(data, 0, st)
    al = st["array_lengths"]
    return {
        "root_type": type(data).__name__,
        "max_depth": st["max_depth"],
        "n_nodes": st["n_nodes"],
        "type_counts": dict(st["types"]),
        "top_keys": [{"key": k, "count": c} for k, c in st["keys"].most_common(40)],
        "n_arrays": len(al),
        "array_lengths": {"min": min(al), "max": max(al), "total": sum(al)} if al else None,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = stats(args.file)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
