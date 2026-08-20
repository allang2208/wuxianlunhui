#!/usr/bin/env python3
"""Constrain a keyed building body to its deterministic Blender depth silhouette."""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def parse_args():
    parser = argparse.ArgumentParser(description="Apply a Blender depth silhouette as an alpha limit.")
    parser.add_argument("body", type=Path)
    parser.add_argument("depth", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--edge-pad", type=int, default=3,
                        help="small mask dilation in px to retain anti-aliased architectural edges")
    return parser.parse_args()


def main():
    args = parse_args()
    body = Image.open(args.body).convert("RGBA")
    depth = Image.open(args.depth).convert("RGBA")
    if body.size != depth.size:
        raise SystemExit(f"size mismatch: body={body.size}, depth={depth.size}")
    depth_rgb = np.asarray(depth)[..., :3]
    mask = Image.fromarray((depth_rgb.max(axis=2) > 4).astype(np.uint8) * 255, "L")
    if args.edge_pad > 0:
        mask = mask.filter(ImageFilter.MaxFilter(args.edge_pad * 2 + 1))
    rgba = np.asarray(body).copy()
    rgba[..., 3] = np.minimum(rgba[..., 3], np.asarray(mask))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.out)
    print(f"silhouette alpha={np.count_nonzero(rgba[..., 3]) / rgba[..., 3].size:.1%} -> {args.out}")


if __name__ == "__main__":
    main()
