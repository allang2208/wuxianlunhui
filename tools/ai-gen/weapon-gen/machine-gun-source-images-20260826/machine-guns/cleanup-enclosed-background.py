#!/usr/bin/env python3
"""Remove baked near-white background islands trapped inside weapon silhouettes."""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def cutout(src: Path, dst: Path, min_enclosed_area: int) -> None:
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    near_white = np.abs(rgb - np.array([250, 250, 250], dtype=np.int16)).sum(axis=2) <= 30
    labels, count = ndimage.label(near_white)
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    sizes = ndimage.sum(near_white, labels, range(1, count + 1))

    background = np.zeros(near_white.shape, dtype=bool)
    removed_islands = []
    for label, size in enumerate(sizes, 1):
        if label in border_labels or size >= min_enclosed_area:
            background |= labels == label
            if label not in border_labels:
                removed_islands.append(int(size))

    foreground = ~background
    foreground_labels, foreground_count = ndimage.label(foreground)
    if foreground_count == 0:
        raise RuntimeError(f"{src}: no foreground found")
    foreground_sizes = ndimage.sum(foreground, foreground_labels, range(1, foreground_count + 1))
    mask = foreground_labels == (1 + int(np.argmax(foreground_sizes)))
    mask = ndimage.binary_erosion(mask, iterations=1)

    alpha_float = ndimage.gaussian_filter(mask.astype(np.float32), sigma=1.0)
    alpha = np.clip(alpha_float * 255, 0, 255).astype(np.uint8)
    alpha_normalized = alpha_float[..., None]
    white = np.array([250.0, 250.0, 250.0], dtype=np.float32)
    clean_rgb = (rgb.astype(np.float32) - (1.0 - alpha_normalized) * white) / np.maximum(alpha_normalized, 1e-3)
    clean_rgb = np.clip(clean_rgb, 0, 255).astype(np.uint8)

    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack([clean_rgb, alpha]).astype(np.uint8), "RGBA").save(dst)
    print(f"saved {dst}; removed enclosed near-white islands={removed_islands}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    parser.add_argument("--min-enclosed-area", type=int, default=1000)
    args = parser.parse_args()
    cutout(args.src, args.dst, args.min_enclosed_area)


if __name__ == "__main__":
    main()
