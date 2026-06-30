# /// script
# requires-python = ">=3.10"
# dependencies = ["scenedetect[opencv]>=0.6"]
# ///
"""Detect scene/shot boundaries (content-aware) → timestamp ranges.

Usage: uv run scene_detect.py <video> [--threshold 27] [--json]
Output: {n_scenes, scenes:[{index,start,end,duration}]}
Heavier (opencv); installed on first use, cached.
"""
import argparse, json, sys


def detect(video: str, threshold: float) -> dict:
    from scenedetect import detect as sd_detect, ContentDetector
    scenes = sd_detect(video, ContentDetector(threshold=threshold))
    out = []
    for i, (start, end) in enumerate(scenes):
        out.append({
            "index": i,
            "start": round(start.get_seconds(), 3),
            "end": round(end.get_seconds(), 3),
            "duration": round(end.get_seconds() - start.get_seconds(), 3),
        })
    return {"n_scenes": len(out), "scenes": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("--threshold", type=float, default=27.0, help="content threshold (lower = more scenes)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = detect(args.video, args.threshold)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
