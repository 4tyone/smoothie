# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Split audio into non-silent segments via ffmpeg silencedetect — useful to chunk a
long recording (e.g. per utterance/track) before transcription. Light (ffmpeg only).

Usage: uv run segment_silence.py <audio> [--noise -30dB] [--min-silence 0.5] [--json]
Output: {n_segments, segments:[{index,start,end,duration}]}
"""
import argparse, json, re, subprocess, sys


def detect(path, noise, min_sil) -> dict:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", path, "-af",
         f"silencedetect=noise={noise}:d={min_sil}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    log = proc.stderr
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", log)]
    dur = None
    md = re.search(r"Duration: (\d+):(\d+):([\d.]+)", log)
    if md:
        h, m, s = md.groups(); dur = int(h) * 3600 + int(m) * 60 + float(s)
    # Non-silent spans are the complement of the silence intervals.
    segs, cursor, idx = [], 0.0, 0
    sil = sorted(zip(starts, ends + [dur] * (len(starts) - len(ends))))
    for s, e in sil:
        if s > cursor + 0.05:
            segs.append({"index": idx, "start": round(cursor, 3), "end": round(s, 3),
                         "duration": round(s - cursor, 3)}); idx += 1
        cursor = e if e else cursor
    if dur and cursor < dur - 0.05:
        segs.append({"index": idx, "start": round(cursor, 3), "end": round(dur, 3),
                     "duration": round(dur - cursor, 3)})
    return {"n_segments": len(segs), "duration_s": dur, "segments": segs}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio")
    ap.add_argument("--noise", default="-30dB", help="silence threshold (default -30dB)")
    ap.add_argument("--min-silence", type=float, default=0.5, help="min silence seconds")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = detect(args.audio, args.noise, args.min_silence)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
