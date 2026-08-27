#!/usr/bin/env python3
"""Build enlarged checkerboard/alpha contacts for crossbow matte review."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "previews" / "matte-review"
ACTIONS = ("idle", "attacking")
TILE = 256
CONTENT_PAD = 12


def checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    yy, xx = np.indices((size[1], size[0]))
    values = np.where(((xx // square) + (yy // square)) % 2 == 0, 54, 92)
    rgb = np.repeat(values[..., None], 3, axis=2).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def content_crop(cell: Image.Image) -> Image.Image:
    alpha = np.asarray(cell.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        return cell
    x0 = max(0, int(xs.min()) - CONTENT_PAD)
    y0 = max(0, int(ys.min()) - CONTENT_PAD)
    x1 = min(cell.width, int(xs.max()) + CONTENT_PAD + 1)
    y1 = min(cell.height, int(ys.max()) + CONTENT_PAD + 1)
    return cell.crop((x0, y0, x1, y1))


def make_contact(action: str, spec: dict[str, object]) -> None:
    sheet = Image.open(SOURCE_DIR / f"{action}.png").convert("RGBA")
    frame_width = int(spec["frameWidth"])
    frame_height = int(spec["frameHeight"])
    frame_count = int(spec["frameCount"])
    cols = 8
    rows = (frame_count + cols - 1) // cols
    page = Image.new("RGB", (cols * TILE, rows * (TILE + 28)), (22, 22, 22))
    draw = ImageDraw.Draw(page)
    for index in range(frame_count):
        sx = (index % 8) * frame_width
        sy = (index // 8) * frame_height
        crop = content_crop(sheet.crop((sx, sy, sx + frame_width, sy + frame_height)))
        scale = min((TILE - 16) / crop.width, (TILE - 16) / crop.height)
        resized = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.NEAREST,
        )
        tile = checkerboard((TILE, TILE))
        x = (TILE - resized.width) // 2
        y = (TILE - resized.height) // 2
        tile.paste(resized, (x, y), resized)
        px = (index % cols) * TILE
        py = (index // cols) * (TILE + 28)
        page.paste(tile, (px, py))
        draw.text((px + 7, py + TILE + 6), f"{action} {index:02d}", fill=(235, 235, 235))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    page.save(OUTPUT_DIR / f"{action}-checker-enlarged.png", optimize=True)


def main() -> None:
    report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    for action in ACTIONS:
        make_contact(action, report["actions"][action])


if __name__ == "__main__":
    main()
