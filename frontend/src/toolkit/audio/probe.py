# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Probe an audio file with ffprobe → duration, codec, channels, sample rate, tags.

Usage: uv run probe.py <audio> [--json]
Requires: ffprobe (system).
"""
import argparse, json, subprocess, sys


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    meta = json.loads(out)
    fmt = meta.get("format", {})
    a = next((s for s in meta.get("streams", []) if s.get("codec_type") == "audio"), {})
    return {
        "duration_s": round(float(fmt["duration"]), 3) if fmt.get("duration") else None,
        "format": fmt.get("format_name"),
        "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        "codec": a.get("codec_name"), "channels": a.get("channels"),
        "sample_rate": a.get("sample_rate"),
        "tags": {k: v for k, v in (fmt.get("tags") or {}).items()},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = probe(args.audio)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
