#!/usr/bin/env python3
"""Rank natural loop windows inside a white-background character video."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
import cv2
import numpy as np


def decode(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def normalize_subject(frame: np.ndarray, size: int = 256, target_height: int = 224) -> np.ndarray:
    distance = 255 - frame.min(axis=2)
    mask = (distance > 18).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("Unable to isolate video subject")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    width = int(stats[largest, cv2.CC_STAT_WIDTH])
    height = int(stats[largest, cv2.CC_STAT_HEIGHT])
    crop = cv2.cvtColor(frame[y:y + height, x:x + width], cv2.COLOR_RGB2GRAY)
    scale = target_height / max(1, height)
    resized = cv2.resize(
        crop,
        (max(1, round(width * scale)), target_height),
        interpolation=cv2.INTER_AREA,
    )
    canvas = np.full((size, size), 255, np.uint8)
    offset_x = (size - resized.shape[1]) // 2
    offset_y = size - 8 - resized.shape[0]
    x0 = max(0, offset_x)
    x1 = min(size, offset_x + resized.shape[1])
    source_x0 = max(0, -offset_x)
    canvas[offset_y:offset_y + resized.shape[0], x0:x1] = resized[
        :, source_x0:source_x0 + (x1 - x0)
    ]
    return canvas


def delta(left: np.ndarray, right: np.ndarray) -> float:
    foreground = (left < 248) | (right < 248)
    if not foreground.any():
        return 0.0
    return float(np.abs(left.astype(np.float32) - right)[foreground].mean())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True, help="inclusive action range")
    parser.add_argument("--min-frames", type=int, default=12)
    parser.add_argument("--max-frames", type=int, default=28)
    parser.add_argument("--sample-step", type=int, default=1)
    parser.add_argument("--top", type=int, default=16)
    args = parser.parse_args()

    frames = decode(args.video)
    end = min(args.end, len(frames) - 1)
    normalized = {index: normalize_subject(frames[index]) for index in range(args.start, end + 1)}
    ranked: list[tuple[float, int, int, int, float, float, float]] = []
    sample_step = max(1, args.sample_step)
    for start in range(args.start, end + 1):
        for length in range(args.min_frames, args.max_frames + 1):
            last = start + (length - 1) * sample_step
            if last > end:
                continue
            indices = list(range(start, last + 1, sample_step))
            steps = [delta(normalized[left], normalized[right]) for left, right in zip(indices, indices[1:])]
            mean = float(np.mean(steps))
            median = float(np.median(steps))
            if mean < 1.0 or median < 0.5:
                continue
            seam = delta(normalized[last], normalized[start])
            ratio = seam / median
            # Favor a seam that looks like one ordinary source step and avoid
            # windows whose internal step size is wildly inconsistent.
            variability = float(np.std(steps)) / mean
            score = abs(ratio - 1.0) + variability * 0.25
            ranked.append((score, start, last, length, seam, mean, ratio))
    ranked.sort()
    for score, start, last, sample_count, seam, mean, ratio in ranked[:args.top]:
        print(
            f"start={start} last={last} frames={last - start + 1} "
            f"samples={sample_count} step={sample_step} seam={seam:.3f} "
            f"adjacentMean={mean:.3f} ratio={ratio:.3f} score={score:.3f}"
        )


if __name__ == "__main__":
    main()
