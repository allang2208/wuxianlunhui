#!/usr/bin/env python3
"""Replace generated sign lettering with deterministic no-text coin relief.

The edit is deliberately bounded to an authored quadrilateral.  The source
alpha channel is copied back byte-for-byte so an accepted building silhouette,
footprint, and transparent edge cannot drift during sign cleanup.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def parse_quad(value: str) -> list[tuple[float, float]]:
    values = [float(part.strip()) for part in value.split(",")]
    if len(values) != 8:
        raise argparse.ArgumentTypeError("quad requires x0,y0,x1,y1,x2,y2,x3,y3")
    return [(values[index], values[index + 1]) for index in range(0, 8, 2)]


def project(quad: list[tuple[float, float]], u: float, v: float) -> tuple[float, float]:
    """Bilinear projection from a unit sign face to TL,TR,BR,BL screen quad."""
    tl, tr, br, bl = quad
    x = ((1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0]
         + u * v * br[0] + (1 - u) * v * bl[0])
    y = ((1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1]
         + u * v * br[1] + (1 - u) * v * bl[1])
    return x, y


def projected_disc(quad: list[tuple[float, float]], center_u: float,
                   radius_u: float, radius_v: float,
                   scale: float, samples: int = 72) -> list[tuple[float, float]]:
    points = []
    for index in range(samples):
        angle = math.tau * index / samples
        u = center_u + math.cos(angle) * radius_u * scale
        v = 0.5 + math.sin(angle) * radius_v * scale
        points.append(project(quad, u, v))
    return points


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replace one generated sign face with a no-text coin emblem.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--quad", type=parse_quad, required=True,
                        help="inner face TL,TR,BR,BL as x0,y0,... in source pixels")
    parser.add_argument("--coins", type=int, default=3)
    parser.add_argument("--supersample", type=int, default=4)
    args = parser.parse_args()

    if args.coins < 1:
        parser.error("--coins must be positive")
    scale = max(1, args.supersample)
    source = Image.open(args.source).convert("RGBA")
    alpha = np.asarray(source, dtype=np.uint8)[..., 3].copy()
    canvas = Image.new("RGBA", (source.width * scale, source.height * scale),
                       (0, 0, 0, 0))
    outer_quad = [(x * scale, y * scale) for x, y in args.quad]
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Rebuild the entire tiny plaque as three nested authored planes.  This is
    # more reliable than trying to cover glyph antialiasing while preserving a
    # one-pixel generated border, and remains strictly inside the sign quad.
    draw.polygon(outer_quad, fill=(51, 25, 12, 255))
    brass_quad = [
        project(outer_quad, 0.018, 0.045),
        project(outer_quad, 0.982, 0.045),
        project(outer_quad, 0.982, 0.955),
        project(outer_quad, 0.018, 0.955),
    ]
    draw.polygon(brass_quad, fill=(178, 116, 35, 255))
    quad = [
        project(outer_quad, 0.042, 0.10),
        project(outer_quad, 0.958, 0.10),
        project(outer_quad, 0.958, 0.90),
        project(outer_quad, 0.042, 0.90),
    ]
    draw.polygon(quad, fill=(103, 8, 18, 255))

    # Physical circles projected into the same authored sign plane become the
    # correct screen ellipses automatically.  Concentric polygons provide a
    # readable old-brass rim at runtime scale without any glyph-like marks.
    centers = [(index + 1) / (args.coins + 1) for index in range(args.coins)]
    radius_u = min(0.075, 0.30 / max(1, args.coins))
    radius_v = 0.29
    for center_u in centers:
        for ring_scale, color in (
                (1.00, (82, 48, 13, 255)),
                (0.88, (228, 176, 74, 255)),
                (0.70, (136, 82, 21, 255)),
                (0.55, (198, 137, 44, 255))):
            draw.polygon(
                projected_disc(quad, center_u, radius_u, radius_v,
                               ring_scale, samples=72),
                fill=color)
    overlay = canvas.resize(source.size, Image.Resampling.LANCZOS).convert("RGBA")
    result = Image.alpha_composite(source, overlay)
    rgba = np.asarray(result, dtype=np.uint8).copy()
    rgba[..., 3] = alpha
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.output)
    print(f"alpha_preserved={np.array_equal(alpha, rgba[..., 3])} -> {args.output}")


if __name__ == "__main__":
    main()
