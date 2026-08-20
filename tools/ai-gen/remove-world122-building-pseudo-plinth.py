#!/usr/bin/env python3
"""Remove detached model-invented foundation/plinth components from a keyed body."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def _components(mask: np.ndarray):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    for y, x in zip(*np.where(mask & ~seen)):
        if seen[y, x]:
            continue
        stack = [(int(y), int(x))]
        seen[y, x] = True
        pixels = []
        while stack:
            cy, cx = stack.pop()
            pixels.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        yield pixels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()

    rgba = np.asarray(Image.open(args.src).convert("RGBA")).copy()
    alpha = rgba[..., 3]
    mask = alpha >= 32
    removed = 0
    details = []
    h, w = mask.shape
    for pixels in _components(mask):
        if len(pixels) < 64:
            continue
        ys = np.fromiter((p[0] for p in pixels), dtype=np.int32)
        xs = np.fromiter((p[1] for p in pixels), dtype=np.int32)
        min_x, max_x = int(xs.min()), int(xs.max())
        min_y, max_y = int(ys.min()), int(ys.max())
        sample = rgba[ys, xs, :3].astype(np.float32) / 255.0
        channel_max = sample.max(axis=1)
        channel_min = sample.min(axis=1)
        luminance = (sample * np.array([0.299, 0.587, 0.114], dtype=np.float32)).sum(axis=1)
        saturation = np.where(channel_max > 1e-4, (channel_max - channel_min) / channel_max, 0.0)
        wide = (max_x - min_x + 1) >= w * 0.22
        low_detached = min_y >= h * 0.55
        pale = float(luminance.mean()) >= 0.52 and float(saturation.mean()) <= 0.28
        # A model-invented platform is usually a separate, low component. The
        # position/shape rule catches green-key contamination too; color alone
        # is unreliable after keying and antialiasing.
        is_plinth = max_y >= h * 0.86 and wide and (low_detached or pale)
        if is_plinth:
            rgba[ys, xs, 3] = 0
            removed += len(pixels)
            details.append((len(pixels), min_x, min_y, max_x, max_y))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.out)
    print(f"removed_pixels={removed} components={details} -> {args.out}")


if __name__ == "__main__":
    main()
