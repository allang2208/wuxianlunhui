#!/usr/bin/env python3
"""Replace green-screen residue inside an explicitly bounded repair region.

The alpha channel is preserved byte-for-byte.  Only green-dominant RGB pixels
inside --rect are replaced, using the nearest opaque non-green subject pixel.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def parse_rect(value: str) -> tuple[int, int, int, int]:
    parts = tuple(int(part.strip()) for part in value.split(","))
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--rect must be x0,y0,x1,y1")
    x0, y0, x1, y1 = parts
    if x0 < 0 or y0 < 0 or x1 <= x0 or y1 <= y0:
        raise argparse.ArgumentTypeError("--rect must have positive area")
    return parts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--rect", required=True, type=parse_rect)
    parser.add_argument("--min-green", type=int, default=90)
    parser.add_argument("--green-margin", type=int, default=35)
    parser.add_argument("--min-alpha", type=int, default=16)
    args = parser.parse_args()

    rgba = np.asarray(Image.open(args.input).convert("RGBA"), dtype=np.uint8).copy()
    height, width = rgba.shape[:2]
    x0, y0, x1, y1 = args.rect
    if x1 > width or y1 > height:
        raise SystemExit(f"repair rect {args.rect} exceeds image size {width}x{height}")

    rgb16 = rgba[:, :, :3].astype(np.int16)
    alpha = rgba[:, :, 3]
    red, green, blue = rgb16[:, :, 0], rgb16[:, :, 1], rgb16[:, :, 2]
    green_dominant = (
        (green >= args.min_green)
        & (green >= red + args.green_margin)
        & (green >= blue + args.green_margin)
        & (alpha >= args.min_alpha)
    )

    region = np.zeros((height, width), dtype=bool)
    region[y0:y1, x0:x1] = True
    repair = green_dominant & region
    repair_count = int(repair.sum())
    if repair_count == 0:
        raise SystemExit("no matching green-spill pixels found inside repair rect")

    valid_source = (alpha >= args.min_alpha) & ~green_dominant
    if not valid_source.any():
        raise SystemExit("no opaque non-green source pixels available")

    _distance, nearest = distance_transform_edt(~valid_source, return_indices=True)
    rgba[repair, :3] = rgba[nearest[0][repair], nearest[1][repair], :3]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.output)
    ys, xs = np.where(repair)
    print(
        f"repaired_pixels={repair_count} "
        f"bbox=({xs.min()},{ys.min()})-({xs.max()},{ys.max()}) "
        f"alpha_preserved=true -> {args.output}"
    )


if __name__ == "__main__":
    main()
