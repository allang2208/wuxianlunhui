#!/usr/bin/env python3
"""Build a labeled close-up contact sheet for selected Doubao source frames."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--frames", required=True, help="comma-separated 0-based source frames")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--crop", default="40,20,760,700", help="left,top,right,bottom")
    args = parser.parse_args()

    selected = [int(value) for value in args.frames.split(",") if value.strip()]
    crop = tuple(int(value) for value in args.crop.split(","))
    if len(crop) != 4:
        raise SystemExit("--crop needs left,top,right,bottom")

    with av.open(str(args.video.resolve())) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not selected or min(selected) < 0 or max(selected) >= len(frames):
        raise SystemExit(f"selected frames outside decoded range 0..{len(frames) - 1}")

    cell_w, image_h, label_h, cols = 420, 397, 23, 4
    rows = math.ceil(len(selected) / cols)
    contact = Image.new("RGB", (cols * cell_w, rows * (image_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for slot, source_index in enumerate(selected):
        image = frames[source_index].crop(crop)
        image.thumbnail((cell_w, image_h), Image.Resampling.LANCZOS)
        x = slot % cols * cell_w + (cell_w - image.width) // 2
        y = slot // cols * (image_h + label_h) + (image_h - image.height) // 2
        contact.paste(image, (x, y))
        draw.text(
            (slot % cols * cell_w + 6, slot // cols * (image_h + label_h) + image_h + 3),
            f"source f{source_index}  {source_index / fps:.3f}s",
            fill="white",
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    contact.save(args.out)
    print(f"[doubao-detail] {args.out}: {len(selected)} frames from 0..{len(frames) - 1} at {fps:g}fps")


if __name__ == "__main__":
    main()
