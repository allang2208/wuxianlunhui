#!/usr/bin/env python3
"""Create an indexed contact sheet from evenly sampled video frames."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--count", type=int, default=9)
    parser.add_argument("--cols", type=int, default=3)
    parser.add_argument("--thumb", default="384x216")
    args = parser.parse_args()

    container = av.open(str(args.video))
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError("video contains no decoded frames")
    wanted = min(args.count, len(frames))
    indexes = np.linspace(0, len(frames) - 1, wanted).round().astype(int).tolist()
    thumb_w, thumb_h = (int(value) for value in args.thumb.lower().split("x"))
    label_h = 24
    rows = math.ceil(wanted / args.cols)
    sheet = Image.new("RGB", (args.cols * thumb_w, rows * (thumb_h + label_h)), (22, 22, 22))
    draw = ImageDraw.Draw(sheet)
    for cell, index in enumerate(indexes):
        thumb = frames[index].resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (cell % args.cols) * thumb_w
        y = (cell // args.cols) * (thumb_h + label_h)
        sheet.paste(thumb, (x, y))
        draw.text((x + 8, y + thumb_h + 4), f"frame {index}", fill=(255, 255, 255))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    print(f"{args.video}: decoded={len(frames)}, samples={indexes} -> {args.out}")


if __name__ == "__main__":
    main()
