#!/usr/bin/env python3
"""Normalize transparent firearm inventory icons to the project icon contract.

The visible alpha bounding box is centered on a 1536 square canvas, its longest
edge is scaled to 90% of the frame, and extreme silhouettes are gently stretched
along their short axis into the supported [0.72, 1.40] aspect range.  Stretching
preserves the complete stock and muzzle, unlike an aspect-ratio crop.
"""

import argparse
import os

import numpy as np
from PIL import Image


CANVAS = 1536
TARGET = round(CANVAS * 0.90)
ALPHA_THRESHOLD = 8
MIN_ASPECT = 0.725
MAX_ASPECT = 1.395


def normalize(path: str) -> None:
    image = Image.open(path).convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if len(xs) == 0:
        raise RuntimeError(f"{path}: no visible content")

    crop = image.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    width, height = crop.size
    aspect = width / height
    if aspect > MAX_ASPECT:
        height = round(width / MAX_ASPECT)
    elif aspect < MIN_ASPECT:
        width = round(height * MIN_ASPECT)
    if crop.size != (width, height):
        crop = crop.resize((width, height), Image.Resampling.LANCZOS)

    scale = TARGET / max(crop.size)
    size = tuple(max(1, round(value * scale)) for value in crop.size)
    crop = crop.resize(size, Image.Resampling.LANCZOS)

    # Re-crop after resampling so the alpha bbox, not the source rectangle, is centered.
    alpha = np.asarray(crop)[:, :, 3]
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    crop = crop.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - crop.width) // 2
    y = (CANVAS - crop.height) // 2
    # The source already carries the desired alpha. Supplying it again as the
    # paste mask would square semi-transparent edge alpha on repeated runs.
    canvas.paste(crop, (x, y))
    canvas.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="transparent PNG file or directory")
    args = parser.parse_args()

    paths = []
    if os.path.isdir(args.path):
        paths = [
            os.path.join(args.path, name)
            for name in sorted(os.listdir(args.path))
            if name.lower().endswith(".png")
        ]
    else:
        paths = [args.path]

    for path in paths:
        normalize(path)
        print(f"normalized {path}")


if __name__ == "__main__":
    main()
