# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Extract representative keyframes (I-frames) from a video — one image per visual
beat, evenly thinned to a budget. Light (ffmpeg I-frame selection, no opencv).

Usage: uv run keyframes.py <video> [--max 12] [--out keyframes] [--json]
Output: {n_keyframes, keyframes:[{path, index}]}
For scene-accurate boundaries use scene_detect.py; this is the fast visual-summary path.
"""
import argparse, glob, json, os, subprocess, sys


def extract(video: str, out: str, cap: int) -> dict:
    os.makedirs(out, exist_ok=True)
    pat = os.path.join(out, "kf_%04d.jpg")
    # Select keyframes (I-frames); vsync passthrough keeps only selected frames.
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", video,
         "-vf", "select='eq(pict_type,I)'", "-vsync", "vfr", "-q:v", "2", pat],
        capture_output=True, check=True,
    )
    files = sorted(glob.glob(os.path.join(out, "kf_*.jpg")))
    # Thin evenly to the budget.
    if cap and len(files) > cap:
        step = len(files) / cap
        keep = {files[min(len(files) - 1, int(i * step))] for i in range(cap)}
        for f in files:
            if f not in keep:
                os.remove(f)
        files = sorted(keep)
    return {"n_keyframes": len(files),
            "keyframes": [{"path": f, "index": i} for i, f in enumerate(files)]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("--max", type=int, default=12, help="max keyframes to keep (default 12)")
    ap.add_argument("--out", default="keyframes", help="output directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = extract(args.video, args.out, args.max)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
