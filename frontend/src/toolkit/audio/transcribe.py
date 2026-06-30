# /// script
# requires-python = ">=3.10"
# dependencies = ["faster-whisper>=1.0"]
# ///
"""Transcribe audio to timestamped segments with faster-whisper (offline, local).

Usage: uv run transcribe.py <audio> [--model small] [--lang auto] [--out transcript.json] [--json]
Output: {language, duration, text, segments:[{id,start,end,text}]}
First run downloads the model (cached). Pair with sentiment_segments.py.
"""
import argparse, json, sys


def transcribe(path: str, model_size: str, language: str | None) -> dict:
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, language=language, vad_filter=True)
    segs, full = [], []
    for i, s in enumerate(segments):
        text = s.text.strip()
        segs.append({"id": i, "start": round(s.start, 3), "end": round(s.end, 3), "text": text})
        full.append(text)
    return {"language": info.language, "duration": round(info.duration, 3),
            "n_segments": len(segs), "text": " ".join(full), "segments": segs}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio")
    ap.add_argument("--model", default="small")
    ap.add_argument("--lang", default="auto")
    ap.add_argument("--out")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = transcribe(args.audio, args.model, None if args.lang == "auto" else args.lang)
        if args.out:
            json.dump(result, open(args.out, "w"), ensure_ascii=False); result["_written"] = args.out
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
