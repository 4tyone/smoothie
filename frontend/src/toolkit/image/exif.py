# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Read EXIF metadata (camera, timestamp, GPS) from an image.

Usage: uv run exif.py <image> [--json]
Output: {has_exif, exif:{...}, gps:{lat,lon}|null}
"""
import argparse, json, sys


def to_deg(val, ref):
    d, m, s = [float(x) for x in val]
    deg = d + m / 60 + s / 3600
    return -deg if ref in ("S", "W") else deg


def read(path: str) -> dict:
    from PIL import Image, ExifTags
    im = Image.open(path)
    raw = im.getexif()
    if not raw:
        return {"has_exif": False, "exif": {}, "gps": None}
    exif = {}
    for tag_id, v in raw.items():
        name = ExifTags.TAGS.get(tag_id, str(tag_id))
        if isinstance(v, bytes):
            v = v.decode("utf-8", "replace")
        exif[name] = str(v)[:200]
    gps = None
    gps_ifd = raw.get_ifd(ExifTags.IFD.GPSInfo) if hasattr(ExifTags, "IFD") else {}
    if gps_ifd:
        g = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
        try:
            gps = {"lat": round(to_deg(g["GPSLatitude"], g["GPSLatitudeRef"]), 6),
                   "lon": round(to_deg(g["GPSLongitude"], g["GPSLongitudeRef"]), 6)}
        except Exception:
            gps = None
    return {"has_exif": True, "exif": exif, "gps": gps}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    try:
        result = read(args.image)
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__})); sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
