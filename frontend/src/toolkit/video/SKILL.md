---
name: video
description: Extracts meaning from a video by orchestrating the pre-built video toolkit — probe, transcribe, sentiment-segmented timestamp ranges, scene detection, and frame extraction for vision. Use for .mp4/.mov/.mkv/.webm sources.
---

# Extract from a video

The source video is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/video/`. **Orchestrate it with `run_command` (`uv run …`) — do
not write ffmpeg/extraction code from scratch.** Use `run_python` only for
data-specific glue (reshaping a tool's JSON, combining results). `uv` installs each
script's dependencies on first use (cached).

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/video/<script>" <video> --json`)

| script | what it returns |
|---|---|
| `probe.py` | duration, fps, resolution, codecs, `has_audio` |
| `transcribe.py` | `{segments:[{start,end,text}], language, text}` (faster-whisper) — add `--out transcript.json` |
| `sentiment_segments.py --transcript transcript.json` | consecutive segments grouped by sentiment, with timestamp ranges |
| `scene_detect.py` | content-aware scene boundaries `[{start,end}]` |
| `extract_frames.py --at T` / `--range S E --count N` | frames written to a dir → `[{path,timestamp_s}]` |
| `keyframes.py --max 12` | representative I-frames to a dir |

## Recommended workflow

1. `probe.py` — get duration/resolution; note whether there's audio.
2. If audio: `transcribe.py <video> --out transcript.json` → then
   `sentiment_segments.py --transcript transcript.json` for sentiment-tagged time ranges.
3. For each notable moment (a sentiment range, a scene boundary, a topic shift):
   `extract_frames.py <video> --range <start> <end> --count 3 --out frames`, then
   **attach the returned frame paths with `read_image`** (up to 4 per call — a burst
   around one moment, since an effect often lags its trigger). A frame you did not
   attach is invisible; extracting it is not seeing it.
4. Use `scene_detect.py` / `keyframes.py` for a visual summary of a video with little
   speech — then `read_image` the frames you want to reason about.

## Facts & locators

Produce facts about what is said and shown — topics, claims, on-screen text, actions,
sentiment shifts. Cite a `locator` per fact: `"t=72s"` or `"00:01:12–00:01:48"`, and
prefer the structured span for time media: `"span": { "kind": "time", "t_start": 72,
"t_end": 96 }` (derive the numbers from tool output — transcript segments, scene
boundaries, frame timestamps — never estimate them). Only state what the transcript
or frames you actually attached support; **never author a visual fact from a frame
you did not `read_image`**.
