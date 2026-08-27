#!/usr/bin/env python3
"""Build a centered 128x64 construction-panel thumbnail from a transparent PNG."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.where(alpha >= 8)
    if len(xs) == 0:
        raise SystemExit("source has no visible pixels")
    crop = source.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    crop.thumbnail((122, 58), Image.Resampling.LANCZOS)
    target = Image.new("RGBA", (128, 64), (0, 0, 0, 0))
    target.alpha_composite(crop, ((128 - crop.width) // 2, (64 - crop.height) // 2))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    target.save(args.output, optimize=True)


if __name__ == "__main__":
    main()
