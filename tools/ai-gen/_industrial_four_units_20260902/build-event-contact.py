#!/usr/bin/env python3
"""Build a labeled, frame-by-frame contact sheet for one H3 event window."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--step", type=int, default=1)
    parser.add_argument("--cols", type=int, default=8)
    parser.add_argument("--tile-width", type=int, default=256)
    args = parser.parse_args()

    capture = cv2.VideoCapture(str(args.video))
    frames: dict[int, Image.Image] = {}
    index = 0
    wanted = set(range(args.start, args.end + 1, args.step))
    while True:
        ok, bgr = capture.read()
        if not ok:
            break
        if index in wanted:
            frames[index] = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        index += 1
    capture.release()

    indices = sorted(frames)
    if not indices:
        raise RuntimeError(f"no frames decoded from {args.video}")
    source = frames[indices[0]]
    tile_height = round(source.height * args.tile_width / source.width)
    label_height = 24
    rows = math.ceil(len(indices) / args.cols)
    contact = Image.new(
        "RGB", (args.cols * args.tile_width, rows * (tile_height + label_height)), "#20242a"
    )
    draw = ImageDraw.Draw(contact)
    for position, frame_index in enumerate(indices):
        x = position % args.cols * args.tile_width
        y = position // args.cols * (tile_height + label_height)
        contact.paste(
            frames[frame_index].resize((args.tile_width, tile_height), Image.Resampling.LANCZOS),
            (x, y),
        )
        draw.text((x + 6, y + tile_height + 4), f"frame {frame_index}", fill="white")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    contact.save(args.output, optimize=True)


if __name__ == "__main__":
    main()
