---
name: image
description: Describes an image by attaching it with read_image (real vision) and pulls metadata/OCR/EXIF via the pre-built image toolkit (Pillow, tesseract). Use for .png/.jpg/.gif/.webp/.tiff sources.
---

# Extract from an image

You can see images — but **only after you attach them with the `read_image` tool**.
Nothing is attached automatically: a path is just a string until you `read_image` it.
Attach the source first, then describe precisely what it shows. A pre-built toolkit
at `$SMOOTHIE_TOOLKIT/image/` supplies the non-visual facts; orchestrate it with
`run_command` (`uv run …`).

## Toolkit (`uv run "$SMOOTHIE_TOOLKIT/image/<script>" <image> --json`)

| script | what it returns |
|---|---|
| `probe.py` | dimensions, mode, format, dominant colors |
| `ocr.py [--lang eng]` | OCR text + word boxes (needs system `tesseract`) — supplement for text-heavy images |
| `exif.py` | camera/timestamp/GPS metadata |

## Recommended workflow

1. `probe.py` — dimensions/format. If the file is over ~4MB, downscale a copy first:
   `ffmpeg -i "$SMOOTHIE_SOURCE_PATH" -vf scale=1024:-1 view.png` (keep the original untouched).
2. **`read_image` the source** (or the downscaled copy) — now you can see it.
3. **Classify first**, then extract accordingly:
   - **screenshot** → UI structure, labels, visible state; action facts with draft locators
   - **diagram** → components and their typed relationships
   - **chart** → axes, series, approximate values (never claim exact numbers from pixels)
   - **photo** → what is depicted, only as far as visible
   - **document scan** → `ocr.py` to capture the text exactly, vision for layout/stamps/signatures
4. `ocr.py` when exact wording matters; `exif.py` if provenance (when/where/with-what) matters.

## Facts & locators

Produce facts about the image's content (and OCR text / EXIF when relevant). Cite
`locator: "image"` (or a described region, e.g. `"top-right legend"`). Describe only
what is visible in an image you actually attached; **never author a visual fact for
an image you did not `read_image`** — if you could not attach it, record that as a
gap instead of guessing.
