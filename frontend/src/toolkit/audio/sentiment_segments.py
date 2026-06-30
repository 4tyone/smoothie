# /// script
# requires-python = ">=3.10"
# dependencies = ["vaderSentiment>=3.3"]
# ///
"""Group a transcript's segments into consecutive runs of the same sentiment with
timestamp ranges (light/offline, VADER). Same as the video tool — works on any
transcript.json from transcribe.py.

Usage: uv run sentiment_segments.py --transcript transcript.json [--threshold 0.05] [--json]
Output: {ranges:[{start,end,sentiment,score,n_segments,text}], overall}
"""
import argparse, json, sys


def label(c, thr):
    return "positive" if c >= thr else "negative" if c <= -thr else "neutral"


def hms(t):
    t = int(t); return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def run(transcript, thr):
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    an = SentimentIntensityAnalyzer()
    scored = [{**s, "score": an.polarity_scores(s.get("text", ""))["compound"]}
              for s in transcript.get("segments", [])]
    for s in scored:
        s["sentiment"] = label(s["score"], thr)
    ranges, cur = [], None
    for s in scored:
        if cur and s["sentiment"] == cur["sentiment"]:
            cur["end"] = s["end"]; cur["_s"].append(s["score"]); cur["_t"].append(s.get("text", ""))
        else:
            if cur:
                ranges.append(cur)
            cur = {"start": s["start"], "end": s["end"], "sentiment": s["sentiment"],
                   "_s": [s["score"]], "_t": [s.get("text", "")]}
    if cur:
        ranges.append(cur)
    out = [{"start": round(r["start"], 3), "end": round(r["end"], 3),
            "range": f"{hms(r['start'])}–{hms(r['end'])}", "sentiment": r["sentiment"],
            "score": round(sum(r["_s"]) / len(r["_s"]), 3), "n_segments": len(r["_s"]),
            "text": " ".join(t.strip() for t in r["_t"]).strip()} for r in ranges]
    overall = round(sum(s["score"] for s in scored) / len(scored), 3) if scored else 0.0
    return {"n_ranges": len(out), "overall_score": overall, "overall": label(overall, thr), "ranges": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--transcript", required=True, help="transcript.json path or '-' for stdin")
    ap.add_argument("--threshold", type=float, default=0.05)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        raw = sys.stdin.read() if args.transcript == "-" else open(args.transcript).read()
        result = run(json.loads(raw), args.threshold)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
