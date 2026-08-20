#!/usr/bin/env python3
"""Remove the deliberately uniform chroma-key backdrop from a World-122 body render.

Unlike the generic transparent cutout route, this keeps only the background
connected to the canvas edge, so green/blue stained glass inside the building
cannot be mistaken for background.
"""

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Chroma-key a World-122 building body render.")
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    parser.add_argument("--threshold", type=float, default=128.0,
                        help="RGB distance from the corner background accepted as backdrop; higher removes green edge fringe")
    return parser.parse_args()


def edge_background_mask(close):
    h, w = close.shape
    mask = np.zeros((h, w), dtype=bool)
    todo = deque()
    for x in range(w):
        todo.append((0, x))
        todo.append((h - 1, x))
    for y in range(1, h - 1):
        todo.append((y, 0))
        todo.append((y, w - 1))
    while todo:
        y, x = todo.popleft()
        if mask[y, x] or not close[y, x]:
            continue
        mask[y, x] = True
        if x: todo.append((y, x - 1))
        if x + 1 < w: todo.append((y, x + 1))
        if y: todo.append((y - 1, x))
        if y + 1 < h: todo.append((y + 1, x))
    return mask


def main():
    args = parse_args()
    rgba = np.asarray(Image.open(args.src).convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.float32)
    corners = np.vstack((rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
                         rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3)))
    key = np.median(corners, axis=0)
    distance = np.linalg.norm(rgb - key, axis=2)
    background = edge_background_mask(distance <= args.threshold)
    rgba[..., 3][background] = 0
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.dst)
    print(f"key={tuple(round(float(v), 1) for v in key)} background={background.mean():.1%} -> {args.dst}")


if __name__ == "__main__":
    main()
