#!/usr/bin/env python3
"""Rank true same-phase loop endpoints in a white-background character video."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
import cv2
import numpy as np


def decode(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def normalize_subject(frame: np.ndarray, size: int = 256, target_height: int = 224):
    distance = 255 - frame.min(axis=2)
    rough = (distance > 18).astype(np.uint8)
    rough = cv2.morphologyEx(rough, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(rough, 8)
    if count <= 1:
        raise RuntimeError("Unable to isolate video subject")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    width = int(stats[largest, cv2.CC_STAT_WIDTH])
    height = int(stats[largest, cv2.CC_STAT_HEIGHT])
    crop = frame[y:y + height, x:x + width]
    mask = (labels[y:y + height, x:x + width] == largest).astype(np.uint8)
    scale = target_height / max(1, height)
    resized_w = max(1, round(width * scale))
    rgb = cv2.resize(crop, (resized_w, target_height), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(mask, (resized_w, target_height), interpolation=cv2.INTER_NEAREST)
    canvas = np.full((size, size, 3), 255, np.uint8)
    canvas_mask = np.zeros((size, size), np.uint8)
    offset_x = (size - resized_w) // 2
    offset_y = size - 8 - target_height
    x0 = max(0, offset_x)
    x1 = min(size, offset_x + resized_w)
    source_x0 = max(0, -offset_x)
    width_inside = x1 - x0
    canvas[offset_y:offset_y + target_height, x0:x1] = rgb[:, source_x0:source_x0 + width_inside]
    canvas_mask[offset_y:offset_y + target_height, x0:x1] = alpha[:, source_x0:source_x0 + width_inside]
    gray = cv2.cvtColor(canvas, cv2.COLOR_RGB2GRAY)
    return gray, canvas_mask


def delta(left: np.ndarray, right: np.ndarray, mask: np.ndarray) -> float:
    if not mask.any():
        return 0.0
    return float(np.abs(left.astype(np.float32) - right)[mask].mean())


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.logical_or(left, right).sum()
    return float(np.logical_and(left, right).sum() / union) if union else 1.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True, help="inclusive action range")
    parser.add_argument("--min-period", type=int, default=12)
    parser.add_argument("--max-period", type=int, default=32)
    parser.add_argument("--sample-step", type=int, default=1)
    parser.add_argument("--mode", choices=("walking", "maintenance"), required=True)
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()

    frames = decode(args.video)
    end = min(args.end, len(frames) - 1)
    normalized = {index: normalize_subject(frames[index]) for index in range(args.start, end + 1)}
    ranked = []
    step = max(1, args.sample_step)
    for start in range(args.start, end + 1):
        for period in range(args.min_period, args.max_period + 1):
            endpoint = start + period
            if endpoint > end or period % step:
                continue
            left, left_mask = normalized[start]
            right, right_mask = normalized[endpoint]
            union = np.logical_or(left_mask, right_mask)
            full_delta = delta(left, right, union)
            leg_top = round(left_mask.shape[0] * 0.65)
            leg_iou = iou(left_mask[leg_top:] > 0, right_mask[leg_top:] > 0)
            upper_top = round(left_mask.shape[0] * 0.18)
            upper_bottom = round(left_mask.shape[0] * 0.72)
            upper_union = union[upper_top:upper_bottom]
            upper_delta = delta(
                left[upper_top:upper_bottom],
                right[upper_top:upper_bottom],
                upper_union,
            )
            indices = list(range(start, endpoint, step))
            adjacent = []
            for first, second in zip(indices, indices[1:]):
                a, am = normalized[first]
                b, bm = normalized[second]
                adjacent.append(delta(a, b, np.logical_or(am, bm)))
            last, last_mask = normalized[indices[-1]]
            seam = delta(last, left, np.logical_or(last_mask, left_mask))
            adjacent_mean = float(np.mean(adjacent)) if adjacent else 0.0
            seam_ratio = seam / max(0.001, adjacent_mean)
            if args.mode == "walking":
                score = full_delta * 0.45 + (1.0 - leg_iou) * 50.0 + abs(seam_ratio - 1.0) * 4.0
            else:
                score = full_delta * 0.55 + upper_delta * 0.45 + abs(seam_ratio - 1.0) * 3.0
            ranked.append((score, start, endpoint, period, full_delta, upper_delta, leg_iou, seam, adjacent_mean, seam_ratio))

    ranked.sort()
    for row in ranked[:args.top]:
        score, start, endpoint, period, full_delta, upper_delta, leg_iou, seam, adjacent_mean, seam_ratio = row
        print(
            f"start={start} endpoint={endpoint} period={period} samples={period // step} "
            f"fullDelta={full_delta:.3f} upperDelta={upper_delta:.3f} legIoU={leg_iou:.4f} "
            f"seam={seam:.3f} adjacentMean={adjacent_mean:.3f} seamRatio={seam_ratio:.3f} "
            f"score={score:.3f}"
        )


if __name__ == "__main__":
    main()
