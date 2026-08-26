#!/usr/bin/env python3
"""Create a leg-region comparison for source keys and RIFE output frames."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
CELL = 512
COLS = 8
SOURCE_COUNT = 31
FINAL_COUNT = 62
CROP = (150, 270, 350, 370)
THUMB = (400, 200)


def cells(path: Path, count: int) -> list[Image.Image]:
    sheet = Image.open(path).convert("RGBA")
    result = []
    for index in range(count):
        row, col = divmod(index, COLS)
        result.append(sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)))
    return result


def checker(frame: Image.Image) -> Image.Image:
    rgba = np.asarray(frame)
    yy, xx = np.indices(rgba.shape[:2])
    shade = np.where(((xx // 12 + yy // 12) % 2)[..., None], 58, 82)
    bg = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32) * alpha + bg * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def montage(frames: list[Image.Image], title: str, path: Path) -> None:
    rows = math.ceil(len(frames) / COLS)
    label_h = 28
    canvas = Image.new("RGB", (COLS * THUMB[0], rows * (THUMB[1] + label_h) + 36), "#20242a")
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 10), title, fill="white")
    for index, frame in enumerate(frames):
        crop = checker(frame.crop(CROP)).resize(THUMB, Image.Resampling.NEAREST)
        x = (index % COLS) * THUMB[0]
        y = 36 + (index // COLS) * (THUMB[1] + label_h)
        canvas.paste(crop, (x, y))
        label = f"f{index} {'KEY' if index % 2 == 0 else 'RIFE'}" if len(frames) == FINAL_COUNT else f"source key {index}"
        draw.text((x + 6, y + THUMB[1] + 5), label, fill="white")
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)


def main() -> None:
    source = cells(ROOT / "source-sheets-pre-interpolation" / "walking.png", SOURCE_COUNT)
    final = cells(ROOT / "sheets" / "interpolated" / "walking.png", FINAL_COUNT)
    out_dir = ROOT / "previews" / "diagnostics"
    montage(source, "walking source keys - leg region", out_dir / "walking-source-legs.png")
    montage(final, "walking RIFE output - leg region", out_dir / "walking-rife-legs.png")


if __name__ == "__main__":
    main()
