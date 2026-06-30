---
name: image
description: Describes an image with vision and pulls metadata/OCR/EXIF via the pre-built image toolkit (Pillow, tesseract). Use for .png/.jpg/.gif/.webp/.tiff sources.
---

# Extract from an image

You have **vision** — the image is attached to this conversation. Look at it and
describe precisely what it shows: UI and labels, on-screen text, charts/diagrams and
their data, depicted actions. A pre-built toolkit at `$SMOOTHIE_TOOLKIT/image/`
supplies the non-visual facts; orchestrate it with `run_command` (`uv run …`).

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/image/<script>" <image> --json`)

| script | what it returns |
|---|---|
| `probe.py` | dimensions, mode, format, dominant colors |
| `ocr.py [--lang eng]` | OCR text + word boxes (needs system `tesseract`) — for text-heavy images (screenshots, scans, slides) |
| `exif.py` | camera/timestamp/GPS metadata |

## Recommended workflow

1. **Describe what you see** (vision) — the primary signal.
2. `probe.py` for dimensions/format.
3. If the image is mostly text (screenshot/scan/slide), `ocr.py` to capture it exactly.
4. `exif.py` if provenance (when/where/with-what) matters.

## Facts & locators

Produce facts about the image's content (and OCR text / EXIF when relevant). Cite
`locator: "image"` (or a described region). Describe only what's visible; don't guess.
