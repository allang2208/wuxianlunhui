#!/usr/bin/env python3
"""Build dense 4-frame interval contacts for choosing source animation windows."""

from __future__ import annotations

from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "previews" / "window-analysis"


def decode(path: Path) -> list[Image.Image]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    return frames


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for action in ("idle", "running", "attacking", "dying"):
        video = ROOT / "videos" / f"{action}-doubao-v01.mp4"
        frames = decode(video)
        indices = list(range(0, len(frames), 4))
        cols = 5
        cell_w, cell_h = 256, 144
        rows = (len(indices) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (245, 245, 245))
        draw = ImageDraw.Draw(sheet)
        for slot, index in enumerate(indices):
            cell = frames[index].resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            x = (slot % cols) * cell_w
            y = (slot // cols) * cell_h
            sheet.paste(cell, (x, y))
            draw.rectangle((x + 3, y + 3, x + 60, y + 22), fill=(0, 0, 0))
            draw.text((x + 7, y + 6), f"f{index:03d}", fill=(255, 255, 255))
        sheet.save(OUT / f"{action}-dense-contact.png")
        print(f"saved {OUT / f'{action}-dense-contact.png'}")


if __name__ == "__main__":
    main()
