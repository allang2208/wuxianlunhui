#!/usr/bin/env python3
"""Derive a deterministic line-control image from a Blender depth render.

Depth ControlNet locks camera and volume but does not clearly describe roof
seams, tower contacts or occlusion boundaries.  This script extracts the
second-order discontinuities from the same depth render so a second chained
Flux2 Fun ControlNet can preserve those structural edges without introducing a
separate hand-authored reference image.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a black/white edge control from a depth PNG.")
    parser.add_argument("depth", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--threshold", type=int, default=10,
                        help="minimum absolute Laplacian response kept as an edge")
    parser.add_argument("--edge-width", type=int, default=2,
                        help="edge dilation radius in pixels")
    args = parser.parse_args()

    depth = np.asarray(Image.open(args.depth).convert("L"), dtype=np.int16)
    laplacian = np.zeros_like(depth, dtype=np.int16)
    center = depth[1:-1, 1:-1]
    laplacian[1:-1, 1:-1] = np.abs(
        center * 4
        - depth[:-2, 1:-1]
        - depth[2:, 1:-1]
        - depth[1:-1, :-2]
        - depth[1:-1, 2:]
    )

    # Explicitly retain silhouette boundaries even when the depth gradient is
    # softly antialiased by Blender.
    occupied = depth > 4
    silhouette = np.zeros_like(occupied)
    silhouette[1:, :] |= occupied[1:, :] != occupied[:-1, :]
    silhouette[:-1, :] |= occupied[:-1, :] != occupied[1:, :]
    silhouette[:, 1:] |= occupied[:, 1:] != occupied[:, :-1]
    silhouette[:, :-1] |= occupied[:, :-1] != occupied[:, 1:]

    edges = ((laplacian >= args.threshold) | silhouette).astype(np.uint8) * 255
    image = Image.fromarray(edges, "L")
    if args.edge_width > 0:
        image = image.filter(ImageFilter.MaxFilter(args.edge_width * 2 + 1))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(args.out)
    print(f"edge_pixels={(np.asarray(image) > 0).mean():.1%} -> {args.out}")


if __name__ == "__main__":
    main()
