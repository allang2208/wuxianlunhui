#!/usr/bin/env python3
"""Prepare clean white Seedance references from the delivery-worker candidates."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SHEETS = ROOT / "candidates"
REFERENCES = ROOT / "references"
PREVIEWS = ROOT / "previews"

CELL = 512
CANVAS = 1024
BODY_HEIGHT = 700
FEET_Y = 875

SOURCES = {
    "empty-idle": SHEETS / "delivery-worker-idle.png",
    # The rejected grid is used only as a right-facing motion keyframe. The
    # rebuilt video sheet will contain no pixels copied from this source.
    "empty-running-keyframe": SHEETS / "delivery-worker-empty-running.png",
    # This rejected run frame is reference-only: it defines the two meal crates.
    # No source run frame is copied into the rebuilt video spritesheet.
    "loaded": SHEETS / "delivery-worker-loaded-running.png",
}


def first_cell(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    return image.crop((0, 0, CELL, CELL))


def normalize(subject: Image.Image) -> Image.Image:
    bbox = subject.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("reference source has no alpha content")
    subject = subject.crop(bbox)
    scale = min(BODY_HEIGHT / subject.height, (CANVAS * 0.70) / subject.width)
    subject = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (CANVAS - subject.width) // 2
    y = FEET_Y - subject.height
    canvas = Image.new("RGB", (CANVAS, CANVAS), "white")
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    return canvas


def main() -> None:
    REFERENCES.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    prepared = {}
    for name, path in SOURCES.items():
        prepared[name] = normalize(first_cell(path))
        out = REFERENCES / f"delivery-worker-{name}-white.png"
        prepared[name].save(out)
        print(f"[delivery-worker-reference] {name}: {prepared[name].size} -> {out}")

    contact = Image.new("RGB", (CANVAS * 3, CANVAS), "#20242a")
    contact.paste(prepared["empty-idle"], (0, 0))
    contact.paste(prepared["empty-running-keyframe"], (CANVAS, 0))
    contact.paste(prepared["loaded"], (CANVAS * 2, 0))
    contact.save(PREVIEWS / "delivery-worker-video-references.jpg", quality=94)


if __name__ == "__main__":
    main()
