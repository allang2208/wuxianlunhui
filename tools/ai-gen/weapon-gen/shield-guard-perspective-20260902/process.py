"""Extract and publish the four approved oblique shield guard renders.

ImageGen returned the approved render on a baked light checkerboard.  The
checkerboard is flood-connected to the canvas edge, so it can be removed
without classifying any enclosed bright metal as background.  The published
1024px sources and 512px Phaser copies share the same square canvas and alpha.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RAW = HERE / "raw"
SOURCE_DIR = ROOT / "assets/weapons/guards"
RUNTIME_DIR = ROOT / "assets/weapons/runtime/weapons/guards"
REPORT = HERE / "process-report.json"
CONTACT = HERE / "shield-guard-four-contact.png"

ASSETS = (
    "moonsilver-deflection-shield-guard",
    "blackiron-citadel-shield-guard",
    "thorn-oath-reprisal-shield-guard",
    "star-eater-arcane-mirror-shield-guard",
)

SOURCE_SIZE = 1024
RUNTIME_SIZE = 512
SAFE_MARGIN = 48


def edge_connected_checker_alpha(image: Image.Image) -> Image.Image:
    """Return alpha after removing the edge-connected near-white checkerboard."""
    rgb = image.convert("RGB")
    pixels = list(rgb.get_flattened_data()) if hasattr(rgb, "get_flattened_data") else list(rgb.getdata())
    candidate = Image.new("L", rgb.size)
    candidate.putdata([
        255 if min(pixel) >= 224 and max(pixel) - min(pixel) <= 22 else 0
        for pixel in pixels
    ])

    # Checker squares touch each other and all four corners.  Mark only the
    # connected outside region, leaving enclosed silver highlights untouched.
    connected = candidate.copy()
    for point in ((0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1)):
        if connected.getpixel(point) == 255:
            ImageDraw.floodfill(connected, point, 128, thresh=0)
    outside = connected.point(lambda value: 255 if value == 128 else 0)
    outside = outside.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    return outside.point(lambda value: 255 - value)


def pack_square(image: Image.Image, alpha: Image.Image, size: int) -> Image.Image:
    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        raise ValueError("background extraction produced an empty shield")
    cropped = rgba.crop(bbox)
    available = size - SAFE_MARGIN * 2
    scale = min(available / cropped.width, available / cropped.height)
    fitted = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size))
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def alpha_bbox(image: Image.Image, threshold: int = 8):
    return image.getchannel("A").point(lambda value: 255 if value > threshold else 0).getbbox()


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    published = []
    for stem in ASSETS:
        raw_path = RAW / f"{stem}-raw.png"
        raw = Image.open(raw_path).convert("RGB")
        alpha = edge_connected_checker_alpha(raw)
        source = pack_square(raw, alpha, SOURCE_SIZE)
        source_path = SOURCE_DIR / f"{stem}.png"
        runtime_path = RUNTIME_DIR / f"{stem}.png"
        source.save(source_path, optimize=True)
        source.resize((RUNTIME_SIZE, RUNTIME_SIZE), Image.Resampling.LANCZOS).save(
            runtime_path, optimize=True
        )
        bbox = alpha_bbox(source)
        records.append({
            "id": stem,
            "raw": raw_path.relative_to(ROOT).as_posix(),
            "source": source_path.relative_to(ROOT).as_posix(),
            "runtime": runtime_path.relative_to(ROOT).as_posix(),
            "sourceSize": list(source.size),
            "runtimeSize": [RUNTIME_SIZE, RUNTIME_SIZE],
            "alphaBBox": list(bbox) if bbox else None,
            "visibleHeightRatio": (bbox[3] - bbox[1]) / SOURCE_SIZE if bbox else 0,
        })
        published.append((stem, source))
        print(f"wrote {source_path.relative_to(ROOT)}")
        print(f"wrote {runtime_path.relative_to(ROOT)}")

    contact = Image.new("RGBA", (SOURCE_SIZE, SOURCE_SIZE), (48, 52, 58, 255))
    contact_draw = ImageDraw.Draw(contact)
    cell_size = SOURCE_SIZE // 2
    for index, (stem, source) in enumerate(published):
        thumb = source.resize((cell_size, cell_size), Image.Resampling.LANCZOS)
        x = index % 2 * cell_size
        y = index // 2 * cell_size
        contact.alpha_composite(thumb, (x, y))
        contact_draw.text((x + 12, y + 10), stem.replace("-shield-guard", ""), fill="white")
    contact.save(CONTACT, optimize=True)

    REPORT.write_text(json.dumps({
        "method": "ImageGen identity-preserving oblique rerender, then edge-connected checkerboard extraction",
        "reference": "assets/weapons/woodshied-equip.png",
        "camera": "wielder on image-left; near left rim thick, far right rim narrow",
        "assets": records,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {CONTACT.relative_to(ROOT)}")
    print(f"wrote {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
