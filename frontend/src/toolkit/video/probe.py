# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Probe a video's container/streams with ffprobe → duration, fps, resolution, codecs.

Usage: uv run probe.py <video> [--json]
Requires: ffprobe (system).
"""
import argparse, json, subprocess, sys


def ffprobe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def summarize(meta: dict) -> dict:
    fmt = meta.get("format", {})
    streams = meta.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), {})

    def fps(s):
        r = s.get("avg_frame_rate") or s.get("r_frame_rate") or "0/0"
        try:
            n, d = r.split("/"); return round(int(n) / int(d), 3) if int(d) else None
        except Exception:
            return None

    return {
        "duration_s": round(float(fmt["duration"]), 3) if fmt.get("duration") else None,
        "size_bytes": int(fmt["size"]) if fmt.get("size") else None,
        "format": fmt.get("format_name"),
        "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        "n_streams": len(streams),
        "video": {
            "codec": v.get("codec_name"), "width": v.get("width"), "height": v.get("height"),
            "fps": fps(v), "pix_fmt": v.get("pix_fmt"), "n_frames": v.get("nb_frames"),
        } if v else None,
        "audio": {
            "codec": a.get("codec_name"), "channels": a.get("channels"),
            "sample_rate": a.get("sample_rate"), "language": (a.get("tags") or {}).get("language"),
        } if a else None,
        "has_audio": bool(a),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video")
    ap.add_argument("--json", action="store_true", help="emit JSON (default)")
    args = ap.parse_args()
    try:
        result = summarize(ffprobe(args.video))
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
