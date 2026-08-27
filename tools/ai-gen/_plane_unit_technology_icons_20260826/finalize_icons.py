#!/usr/bin/env python3
"""Finalize the desert-monk and jungle-priest technology badges."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROJECT = ROOT.parents[2]
RUNTIME = PROJECT / "assets" / "ui" / "technology-icons"
NAMES = ("desert_monastic_order", "jungle_priesthood")


def find_badge_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    hi = rgb.max(axis=2).astype(np.int16)
    lo = rgb.min(axis=2).astype(np.int16)
    chroma = hi - lo
    luma = rgb.mean(axis=2)
    background = (chroma < 24) & ((luma < 72) | (luma > 172))
    mid_x = image.width // 2
    mid_y = image.height // 2
    row = np.where(~background[mid_y, :])[0]
    column = np.where(~background[:, mid_x])[0]
    if not len(row) or not len(column):
        raise RuntimeError("badge bounds not found")
    margin = max(2, round(min(image.size) * 0.002))
    return (
        max(0, int(row[0]) - margin),
        max(0, int(column[0]) - margin),
        min(image.width - 1, int(row[-1]) + margin),
        min(image.height - 1, int(column[-1]) + margin),
    )


def cut_hex_badge(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    left, top, right, bottom = find_badge_bounds(image)
    center_x = (left + right) // 2
    shoulder = round((bottom - top) * 0.25)
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).polygon(
        [
            (center_x, top),
            (right, top + shoulder),
            (right, bottom - shoulder),
            (center_x, bottom),
            (left, bottom - shoulder),
            (left, top + shoulder),
        ],
        fill=255,
    )
    rgba.putalpha(mask.filter(ImageFilter.GaussianBlur(0.65)))
    return rgba


def normalize(image: Image.Image, size: int = 1024, visible_size: int = 1000) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("empty alpha mask")
    crop = rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    scale = min(visible_size / crop.width, visible_size / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
    )
    return canvas


def make_preview(icons: dict[str, Image.Image]) -> None:
    canvas = Image.new("RGBA", (1048, 524), (14, 18, 24, 255))
    for index, icon in enumerate(icons.values()):
        thumb = icon.copy()
        thumb.thumbnail((500, 500), Image.Resampling.LANCZOS)
        x = 12 + index * 512 + (500 - thumb.width) // 2
        y = 12 + (500 - thumb.height) // 2
        canvas.alpha_composite(thumb, (x, y))
    canvas.convert("RGB").save(ROOT / "plane-unit-technology-icons-preview.jpg", quality=94)


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    finalized = {}
    for name in NAMES:
        source = Image.open(RAW / f"{name}-raw.png")
        icon = normalize(cut_hex_badge(source))
        icon.save(RUNTIME / f"{name}.png", optimize=True)
        finalized[name] = icon
    make_preview(finalized)


if __name__ == "__main__":
    main()
