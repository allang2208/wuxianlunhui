#!/usr/bin/env python3
"""Place the transparent red-werewolf master on the H3 cyan stage."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--size", default="1024x576")
    parser.add_argument("--target-h", type=int, default=500)
    parser.add_argument("--foot-y", type=int, default=552)
    parser.add_argument("--bg", default="00E5FF")
    args = parser.parse_args()

    width, height = (int(value) for value in args.size.lower().split("x"))
    source = Image.open(args.src).convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.where(alpha > 12)
    if not len(xs):
        raise RuntimeError("master contains no alpha-bearing subject")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject = source.crop(box)
    scale = args.target_h / subject.height
    resized = subject.resize(
        (max(1, round(subject.width * scale)), args.target_h),
        Image.Resampling.LANCZOS,
    )
    rgb = tuple(int(args.bg[index:index + 2], 16) for index in (0, 2, 4))
    canvas = Image.new("RGBA", (width, height), (*rgb, 255))
    x = round((width - resized.width) / 2)
    y = args.foot_y - resized.height
    if x < 0 or y < 0 or x + resized.width > width or y + resized.height > height:
        raise RuntimeError(f"placed subject does not fit: {resized.width}x{resized.height} at {x},{y}")
    canvas.alpha_composite(resized, (x, y))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(args.out)
    print(f"prepared {args.out}: source_box={box}, placed=({x},{y},{x + resized.width},{y + resized.height})")


if __name__ == "__main__":
    main()
