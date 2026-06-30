# /// script
# requires-python = ">=3.10"
# dependencies = ["vaderSentiment>=3.3"]
# ///
"""Group a transcript's segments into consecutive runs of the same sentiment, with
timestamp ranges — e.g. "00:01:12–00:01:48 negative". Light/offline (VADER, no torch).

Usage: uv run sentiment_segments.py --transcript transcript.json [--threshold 0.05] [--json]
   or: cat transcript.json | uv run sentiment_segments.py --transcript - --json
Input: a transcript.json from transcribe.py ({segments:[{start,end,text}]}).
Output: {ranges:[{start,end,sentiment,score,n_segments,text}], overall}
"""
import argparse, json, sys


def label(compound: float, thr: float) -> str:
    if compound >= thr:
        return "positive"
    if compound <= -thr:
        return "negative"
    return "neutral"


def hms(t: float) -> str:
    t = int(t); return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def run(transcript: dict, thr: float) -> dict:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    an = SentimentIntensityAnalyzer()
    segs = transcript.get("segments", [])
    scored = []
    for s in segs:
        c = an.polarity_scores(s.get("text", ""))["compound"]
        scored.append({**s, "score": c, "sentiment": label(c, thr)})

    ranges, cur = [], None
    for s in scored:
        if cur and s["sentiment"] == cur["sentiment"]:
            cur["end"] = s["end"]; cur["_scores"].append(s["score"]); cur["_texts"].append(s.get("text", ""))
        else:
            if cur:
                ranges.append(cur)
            cur = {"start": s["start"], "end": s["end"], "sentiment": s["sentiment"],
                   "_scores": [s["score"]], "_texts": [s.get("text", "")]}
    if cur:
        ranges.append(cur)

    out = []
    for r in ranges:
        n = len(r["_scores"])
        out.append({
            "start": round(r["start"], 3), "end": round(r["end"], 3),
            "range": f"{hms(r['start'])}–{hms(r['end'])}",
            "sentiment": r["sentiment"], "score": round(sum(r["_scores"]) / n, 3),
            "n_segments": n, "text": " ".join(t.strip() for t in r["_texts"]).strip(),
        })
    overall = round(sum(s["score"] for s in scored) / len(scored), 3) if scored else 0.0
    return {"n_ranges": len(out), "overall_score": overall,
            "overall": label(overall, thr), "ranges": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--transcript", required=True, help="transcript.json path, or '-' for stdin")
    ap.add_argument("--threshold", type=float, default=0.05, help="|compound| neutral band (default 0.05)")
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
