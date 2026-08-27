#!/usr/bin/env python3
"""Compose the approved zombie mother image with the BiRefNet mask.

Outputs both a genuine RGBA cutout and the standardized white H3 first frame.
The H3 geometry matches the accepted spitter-zombie source: 1344x768 canvas,
576 px subject height, x=672 center, y=709 foot line.
"""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "zombie-idle-generated.png"
MASK = ROOT / "zombie-idle-alpha.png"
RGBA_OUT = ROOT / "zombie-idle-cutout.png"
H3_OUT = ROOT / "video" / "zombie-h3-white.png"

CANVAS_SIZE = (1344, 768)
TARGET_HEIGHT = 576
CENTER_X = 672
FOOT_Y = 709


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    alpha = Image.open(MASK).convert("L")
    if source.size != alpha.size:
        raise ValueError(f"source/mask size mismatch: {source.size} vs {alpha.size}")

    rgba = source.convert("RGBA")
    rgba.putalpha(alpha)
    rgba.save(RGBA_OUT)

    mask_np = np.asarray(alpha)
    ys, xs = np.where(mask_np > 8)
    if not len(xs):
        raise ValueError("BiRefNet mask has no foreground pixels")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject = rgba.crop(bbox)
    scale = TARGET_HEIGHT / subject.height
    target_width = max(1, round(subject.width * scale))
    subject = subject.resize((target_width, TARGET_HEIGHT), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", CANVAS_SIZE, "white")
    x = round(CENTER_X - target_width / 2)
    y = FOOT_Y - TARGET_HEIGHT + 1
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    H3_OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(H3_OUT)

    print(f"rgba={RGBA_OUT} source_bbox={bbox}")
    print(f"h3={H3_OUT} subject={target_width}x{TARGET_HEIGHT} at ({x},{y}) foot_y={FOOT_Y}")


if __name__ == "__main__":
    main()
