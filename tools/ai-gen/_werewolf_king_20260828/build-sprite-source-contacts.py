#!/usr/bin/env python3
"""Build dense source contacts used to choose Werewolf King key frames."""

from __future__ import annotations

import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
OUT_DIR = ROOT / "previews" / "sprite-source-analysis"
SPECS = {
    "idle": ("idle-doubao-v01.mp4", range(0, 121, 5)),
    "running": ("running-doubao-v01.mp4", range(16, 121, 4)),
    "attacking": ("attacking-doubao-v01.mp4", range(0, 109, 4)),
    "dying": ("dying-doubao-v02-fixed-scale.mp4", range(0, 85, 4)),
    "howl": ("howl-doubao-v01.mp4", range(0, 121, 4)),
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return [frame.to_image().convert("RGB") for frame in container.decode(stream)]


def build(name: str, video_name: str, requested: range) -> None:
    frames = decode(VIDEO_DIR / video_name)
    indices = [index for index in requested if index < len(frames)]
    cols = 4
    tile_w, tile_h, label_h = 320, 180, 24
    rows = math.ceil(len(indices) / cols)
    sheet = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(sheet)
    for position, index in enumerate(indices):
        x = position % cols * tile_w
        y = position // cols * (tile_h + label_h)
        sheet.paste(frames[index].resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 5, y + tile_h + 4), f"source f{index}", fill="white")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / f"{name}-dense-contact.png")


def main() -> None:
    for name, (video_name, requested) in SPECS.items():
        build(name, video_name, requested)
        print(f"saved {name} dense contact")


if __name__ == "__main__":
    main()
