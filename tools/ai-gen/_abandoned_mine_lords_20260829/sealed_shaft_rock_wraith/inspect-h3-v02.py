#!/usr/bin/env python3
"""Measure subject proportions and scale directly in corrected H3 source videos."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
import cv2
import numpy as np


def subject_bounds(rgb: np.ndarray) -> tuple[int, int, int, int, int]:
    # Generated clips use a near-white studio background. Ignore faint codec noise.
    mask = (np.min(rgb, axis=2) < 235).astype(np.uint8)
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("No foreground subject found")
    keep = np.zeros_like(mask)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= 80:
            keep[labels == label] = 1
    ys, xs = np.where(keep)
    if not len(xs):
        raise RuntimeError("No foreground subject survived filtering")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), int(keep.sum())


def inspect(path: Path) -> None:
    with av.open(str(path)) as container:
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    sample_indices = sorted({0, len(frames) // 8, len(frames) // 4, len(frames) // 2,
                             len(frames) * 3 // 4, len(frames) - 1})
    print(f"{path.name}: frames={len(frames)} size={frames[0].shape[1]}x{frames[0].shape[0]}")
    for index in sample_indices:
        x0, y0, x1, y1, area = subject_bounds(frames[index])
        width, height = x1 - x0 + 1, y1 - y0 + 1
        touches = x0 <= 2 or y0 <= 2 or x1 >= frames[index].shape[1] - 3 or y1 >= frames[index].shape[0] - 3
        print(
            f"  f{index:03d}: bbox={width}x{height} ratio={width / height:.3f} "
            f"area={area} center=({(x0 + x1) / 2:.1f},{(y0 + y1) / 2:.1f}) edge={touches}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", type=Path)
    args = parser.parse_args()
    for video in args.videos:
        inspect(video)
