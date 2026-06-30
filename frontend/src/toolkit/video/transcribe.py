# /// script
# requires-python = ">=3.10"
# dependencies = ["faster-whisper>=1.0"]
# ///
"""Transcribe a video/audio file to timestamped segments with faster-whisper.

Usage: uv run transcribe.py <media> [--model small] [--lang auto] [--out transcript.json] [--json]
Output: {language, duration, text, segments:[{id,start,end,text}]}
First run downloads the model (lazy/local, cached). Decodes audio via ffmpeg.
"""
import argparse, json, sys


def transcribe(path: str, model_size: str, language: str | None) -> dict:
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        path, language=language, vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    segs, full = [], []
    for i, s in enumerate(segments):
        text = s.text.strip()
        segs.append({"id": i, "start": round(s.start, 3), "end": round(s.end, 3), "text": text})
        full.append(text)
    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "n_segments": len(segs),
        "text": " ".join(full),
        "segments": segs,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("media")
    ap.add_argument("--model", default="small", help="tiny|base|small|medium|large-v3 (default small)")
    ap.add_argument("--lang", default="auto", help="language code, or 'auto' to detect")
    ap.add_argument("--out", help="also write the transcript JSON to this path")
    ap.add_argument("--json", action="store_true", help="emit JSON (default)")
    args = ap.parse_args()
    try:
        result = transcribe(args.media, args.model, None if args.lang == "auto" else args.lang)
        if args.out:
            with open(args.out, "w") as f:
                json.dump(result, f, ensure_ascii=False)
            result["_written"] = args.out
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
