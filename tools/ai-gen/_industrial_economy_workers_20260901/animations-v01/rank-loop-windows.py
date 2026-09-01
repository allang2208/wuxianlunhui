"""Rank short natural loop windows in one white-background H3 clip."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import cv2
import numpy as np


def decode(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def subject_view(frame: np.ndarray) -> tuple[np.ndarray, tuple[float, float]]:
    mask = frame.min(axis=2) < 246
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        raise RuntimeError("No subject component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    w = int(stats[largest, cv2.CC_STAT_WIDTH])
    h = int(stats[largest, cv2.CC_STAT_HEIGHT])
    pad = max(w, h) * 0.16
    cx = x + w / 2
    cy = y + h / 2
    side = max(w, h) + pad * 2
    x0 = max(0, round(cx - side / 2))
    y0 = max(0, round(cy - side / 2))
    x1 = min(frame.shape[1], round(cx + side / 2))
    y1 = min(frame.shape[0], round(cy + side / 2))
    crop = cv2.resize(frame[y0:y1, x0:x1], (160, 160), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32)
    return gray, (cx, cy)


def mae(left: np.ndarray, right: np.ndarray) -> float:
    foreground = np.minimum(left, right) < 248
    return float(np.abs(left - right)[foreground].mean()) if foreground.any() else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--min-frames", type=int, default=16)
    parser.add_argument("--max-frames", type=int, default=48)
    parser.add_argument("--top", type=int, default=16)
    args = parser.parse_args()
    frames, fps = decode(args.video)
    prepared = [subject_view(frame) for frame in frames]
    views = [item[0] for item in prepared]
    centers = [item[1] for item in prepared]
    results = []
    for duration in range(args.min_frames, min(args.max_frames, len(frames) - 1) + 1):
        for start in range(0, len(frames) - duration):
            end = start + duration
            seam = mae(views[start], views[end])
            samples = list(range(start, end + 1, 2))
            motion = float(np.mean([
                mae(views[left], views[right]) for left, right in zip(samples, samples[1:])
            ]))
            shift = float(np.hypot(
                centers[start][0] - centers[end][0], centers[start][1] - centers[end][1]
            ))
            # Prefer a clean seam and stable root, but reject nearly frozen windows.
            score = seam + shift * 0.35 + max(0.0, 1.8 - motion) * 6.0
            results.append({
                "start": start,
                "duplicateEndpoint": end,
                "durationFrames": duration,
                "durationSeconds": duration / fps,
                "seamMae": seam,
                "motionMean": motion,
                "rootShiftPx": shift,
                "score": score,
            })
    results.sort(key=lambda item: (item["score"], item["seamMae"], -item["motionMean"]))
    print(json.dumps({
        "video": str(args.video),
        "decodedFrames": len(frames),
        "fps": fps,
        "top": results[:args.top],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
