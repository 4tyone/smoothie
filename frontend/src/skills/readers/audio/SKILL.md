---
name: audio
description: Transcribes audio and extracts timestamped, sentiment-tagged facts by orchestrating the pre-built audio toolkit (faster-whisper, VADER, ffmpeg). Use for .mp3/.wav/.m4a/.flac/.ogg sources.
---

# Extract from audio

The source audio is in your working directory. A pre-built toolkit is at
`$SMOOTHIE_TOOLKIT/audio/`. **Orchestrate it with `run_command` (`uv run …`) — do not
write transcription/ffmpeg code from scratch.** Use `run_python` only for glue.

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/audio/<script>" <audio> --json`)

| script | what it returns |
|---|---|
| `probe.py` | duration, codec, channels, sample rate, tags |
| `transcribe.py` | `{segments:[{start,end,text}], language, text}` — add `--out transcript.json` |
| `sentiment_segments.py --transcript transcript.json` | segments grouped by sentiment, with timestamp ranges |
| `segment_silence.py` | non-silent spans (chunk a long recording before transcribing) |

## Recommended workflow

1. `probe.py` — duration/format.
2. `transcribe.py <audio> --out transcript.json` → the timestamped transcript.
3. `sentiment_segments.py --transcript transcript.json` → sentiment over time.
4. For very long/multi-part audio, `segment_silence.py` first to find natural breaks.

## Facts & locators

Produce facts from the transcript: topics, claims, decisions, speakers if discernible,
sentiment shifts. Cite `locator: "t=<start>s"` or a `"MM:SS–MM:SS"` range. Never invent
a transcript; if transcription fails, record a gap (`fidelity: "guessed"`).
