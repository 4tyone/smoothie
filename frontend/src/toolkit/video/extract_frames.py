# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Extract frames from a video — a single frame at a timestamp, or a set over a range.
Pairs with sentiment_segments.py / scene_detect.py: extract frames for a time range of
interest, then feed them to vision. Uses ffmpeg (no heavy deps).

Usage:
  uv run extract_frames.py <video> --at 00:01:23 [--out frames]
  uv run extract_frames.py <video> --range 72 96 --every 4 [--out frames]   # seconds
  uv run extract_frames.py <video> --range 72 96 --count 5  [--out frames]
Output: {frames:[{path, timestamp_s}]}
"""
import argparse, json, os, subprocess, sys


def grab(video: str, t: float, out_path: str):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-ss", f"{t:.3f}", "-i", video,
         "-frames:v", "1", "-q:v", "2", out_path],
        capture_output=True, check=True,
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("--at", help="single timestamp (seconds or HH:MM:SS)")
    ap.add_argument("--range", nargs=2, type=float, metavar=("START", "END"), help="seconds")
    ap.add_argument("--every", type=float, help="with --range: one frame every N seconds")
    ap.add_argument("--count", type=int, help="with --range: N evenly-spaced frames")
    ap.add_argument("--out", default="frames", help="output directory (default ./frames)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    def to_s(v):
        if ":" in str(v):
            p = [float(x) for x in str(v).split(":")]
            return sum(x * 60 ** i for i, x in enumerate(reversed(p)))
        return float(v)

    try:
        os.makedirs(args.out, exist_ok=True)
        times = []
        if args.at is not None:
            times = [to_s(args.at)]
        elif args.range:
            s, e = args.range
            if args.count:
                step = (e - s) / max(1, args.count - 1) if args.count > 1 else 0
                times = [s + i * step for i in range(args.count)]
            else:
                every = args.every or max(1.0, (e - s) / 10)
                t = s
                while t <= e + 1e-6:
                    times.append(round(t, 3)); t += every
        else:
            ap.error("provide --at or --range")

        frames = []
        for i, t in enumerate(times):
            p = os.path.join(args.out, f"frame_{i:03d}_{int(t*1000):08d}ms.jpg")
            grab(args.video, t, p)
            if os.path.exists(p):
                frames.append({"path": p, "timestamp_s": round(t, 3)})
        result = {"n_frames": len(frames), "frames": frames}
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
