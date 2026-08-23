#!/usr/bin/env python3
"""Create an indexed contact sheet for an exact video frame range."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--step", type=int, default=1)
    parser.add_argument("--cols", type=int, default=8)
    parser.add_argument("--thumb", default="192x192")
    args = parser.parse_args()

    width, height = (int(value) for value in args.thumb.lower().split("x"))
    container = av.open(str(args.video))
    frames = [frame.to_image().convert("RGB") for frame in container.decode(video=0)]
    container.close()
    indices = list(range(args.start, min(args.end + 1, len(frames)), max(1, args.step)))
    rows = math.ceil(len(indices) / args.cols)
    label_h = 22
    contact = Image.new("RGB", (args.cols * width, rows * (height + label_h)), "#1c1f24")
    draw = ImageDraw.Draw(contact)
    for position, source_index in enumerate(indices):
        thumb = frames[source_index].resize((width, height), Image.Resampling.LANCZOS)
        row, col = divmod(position, args.cols)
        x = col * width
        y = row * (height + label_h)
        contact.paste(thumb, (x, y))
        draw.text((x + 5, y + height + 3), f"frame {source_index}", fill="white")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    contact.save(args.out)
    print(f"{args.video}: {len(frames)} frames, range={indices[0]}..{indices[-1]} -> {args.out}")


if __name__ == "__main__":
    main()
