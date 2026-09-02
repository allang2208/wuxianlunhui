#!/usr/bin/env python3
"""Build a dense collapse and corpse review for steel-shield death v01."""

from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "dying-doubao-v01.mp4"
OUTPUT = ROOT / "previews" / "dying-doubao-v01-collapse-f00-f120.png"
INDICES = (0, 12, 24, 36, 48, 56, 62, 68, 74, 78, 82, 88, 94, 100, 110, 120)
CROP = (0, 0, 1280, 720)
COLS = 4
CELL = (480, 270)
LABEL_H = 26


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
        draw.text(
            (col * CELL[0] + 8, row * (CELL[1] + LABEL_H) + CELL[1] + 4),
            f"source f{index} / {index / 24:.3f}s",
            fill="white",
        )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True)


if __name__ == "__main__":
    main()
