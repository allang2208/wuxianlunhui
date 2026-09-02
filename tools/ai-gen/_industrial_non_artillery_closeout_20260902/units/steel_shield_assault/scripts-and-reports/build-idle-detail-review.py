#!/usr/bin/env python3
"""Build an enlarged five-phase identity/direction review for idle v01."""

from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "idle-h3-v01-exact-loop.mp4"
OUTPUT = ROOT / "previews" / "idle-h3-v01-exact-loop-detail-f00-f32-f63-f91-f123.png"
INDICES = (0, 32, 63, 91, 123)
CROP = (340, 36, 980, 750)


def main() -> None:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    cell = (400, 446)
    label_h = 28
    canvas = Image.new("RGB", (cell[0] * len(INDICES), cell[1] + label_h), "#20242a")
    draw = ImageDraw.Draw(canvas)
    for position, index in enumerate(INDICES):
        detail = ImageOps.contain(frames[index].crop(CROP), cell, Image.Resampling.LANCZOS)
        x = position * cell[0] + (cell[0] - detail.width) // 2
        y = (cell[1] - detail.height) // 2
        canvas.paste(detail, (x, y))
        draw.text((position * cell[0] + 8, cell[1] + 5), f"source f{index}", fill="white")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT)


if __name__ == "__main__":
    main()
