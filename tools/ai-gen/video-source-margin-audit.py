#!/usr/bin/env python3
"""Audit subject-to-frame margins in a flat-background character video.

This check deliberately runs on the source video before background removal.
It catches framing loss that a later crop/resize cannot restore.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def largest_component(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), connectivity=8
    )
    if count <= 1:
        return None
    index = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, width, height, _area = stats[index]
    return int(x), int(y), int(width), int(height)


def subject_bbox(frame: np.ndarray, threshold: float) -> tuple[int, int, int, int] | None:
    height, width = frame.shape[:2]
    border = max(4, min(height, width) // 40)
    samples = np.concatenate(
        (
            frame[:border].reshape(-1, 3),
            frame[-border:].reshape(-1, 3),
            frame[:, :border].reshape(-1, 3),
            frame[:, -border:].reshape(-1, 3),
        ),
        axis=0,
    ).astype(np.float32)
    background = np.median(samples, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    mask = distance > threshold
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return largest_component(mask)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--threshold", type=float, default=28.0)
    parser.add_argument(
        "--minimum-margin-ratio",
        type=float,
        default=0.10,
        help="Required margin on every side, relative to source width/height.",
    )
    args = parser.parse_args()

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise SystemExit(f"cannot open video: {args.video}")

    rows: list[dict[str, object]] = []
    frame_index = 0
    frame_width = frame_height = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame_height, frame_width = frame.shape[:2]
        bbox = subject_bbox(frame, args.threshold)
        if bbox is not None:
            x, y, width, height = bbox
            margins = {
                "left": x,
                "right": frame_width - (x + width),
                "top": y,
                "bottom": frame_height - (y + height),
            }
            rows.append({"frame": frame_index, "bbox": [x, y, width, height], **margins})
        frame_index += 1
    capture.release()

    if not rows:
        raise SystemExit("no subject component detected")

    axes = ("left", "right", "top", "bottom")
    minima = {axis: min(int(row[axis]) for row in rows) for axis in axes}
    minimum_frames = {
        axis: [int(row["frame"]) for row in rows if int(row[axis]) == minima[axis]]
        for axis in axes
    }
    required = {
        "left": round(frame_width * args.minimum_margin_ratio),
        "right": round(frame_width * args.minimum_margin_ratio),
        "top": round(frame_height * args.minimum_margin_ratio),
        "bottom": round(frame_height * args.minimum_margin_ratio),
    }
    failures = [axis for axis in axes if minima[axis] < required[axis]]
    report = {
        "video": str(args.video),
        "decodedFrames": frame_index,
        "detectedFrames": len(rows),
        "frameSize": [frame_width, frame_height],
        "minimumMarginRatio": args.minimum_margin_ratio,
        "requiredMargins": required,
        "minimumMargins": minima,
        "minimumMarginFrames": minimum_frames,
        "passed": not failures,
        "failedSides": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not failures else 2)


if __name__ == "__main__":
    main()
