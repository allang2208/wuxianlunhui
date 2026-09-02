#!/usr/bin/env python3
"""Build a dense firing-window review for steel-shield attack v01."""

from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "attacking-doubao-v01.mp4"
OUTPUT = ROOT / "previews" / "attacking-doubao-v01-fire-window-f35-f66.png"
INDICES = (35, 39, 43, 45, 47, 48, 49, 50, 51, 52, 54, 56, 58, 60, 62, 66)
CROP = (180, 35, 1030, 700)
COLS = 4
CELL = (340, 266)
LABEL_H = 24


def main() -> None:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    rows = (len(INDICES) + COLS - 1) // COLS
    canvas = Image.new("RGB", (CELL[0] * COLS, (CELL[1] + LABEL_H) * rows), "#20242a")
    draw = ImageDraw.Draw(canvas)
    for position, index in enumerate(INDICES):
        detail = ImageOps.contain(frames[index].crop(CROP), CELL, Image.Resampling.LANCZOS)
        col = position % COLS
        row = position // COLS
        x = col * CELL[0] + (CELL[0] - detail.width) // 2
        y = row * (CELL[1] + LABEL_H) + (CELL[1] - detail.height) // 2
        canvas.paste(detail, (x, y))
        draw.text((col * CELL[0] + 8, row * (CELL[1] + LABEL_H) + CELL[1] + 4),
                  f"source f{index} / {index / 24:.3f}s", fill="white")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True)


if __name__ == "__main__":
    main()
