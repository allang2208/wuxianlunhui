#!/usr/bin/env python3
"""Measure v03-identity H3 werewolf videos and rank natural loop windows."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
CYAN = np.array([0, 229, 255], dtype=np.float32)
SOURCES = {
    "transform": "transform-h3-v02.mp4",
    "run": "werewolf-run-h3-v02.mp4",
    "attack": "werewolf-attack-h3-v02.mp4",
}


def read_video(path: Path) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    return frames


def subject_mask(frame_bgr: np.ndarray) -> np.ndarray:
    rgb = frame_bgr[..., ::-1].astype(np.float32)
    mask = (np.linalg.norm(rgb - CYAN, axis=2) > 52).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        return np.zeros_like(mask, dtype=bool)
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == keep


def bbox(mask: np.ndarray) -> list[int] | None:
    ys, xs = np.where(mask)
    if not xs.size:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def iou(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.logical_and(first, second).sum() / max(1, np.logical_or(first, second).sum()))


def lower_iou(first: np.ndarray, second: np.ndarray) -> float:
    union = first | second
    ys, _ = np.where(union)
    if not ys.size:
        return 0.0
    y0, y1 = int(ys.min()), int(ys.max())
    cut = y0 + round((y1 - y0) * 0.55)
    return iou(first[cut:y1 + 1], second[cut:y1 + 1])


def loop_candidates(masks: list[np.ndarray]) -> list[dict[str, float | int]]:
    candidates = []
    for start in range(12, min(90, len(masks) - 12), 2):
        for period in range(14, 49, 2):
            end = start + period
            if end >= min(112, len(masks)):
                continue
            full = iou(masks[start], masks[end])
            lower = lower_iou(masks[start], masks[end])
            if full < 0.52 or lower < 0.40:
                continue
            sequence = masks[start:end + 1]
            motion = float(np.mean([1.0 - iou(sequence[i], sequence[i + 1]) for i in range(len(sequence) - 1)]))
            candidates.append({
                "start": start,
                "end": end,
                "period": period,
                "fullSeamIou": round(full, 4),
                "lowerSeamIou": round(lower, 4),
                "meanAdjacentMotion": round(motion, 4),
                "score": round(full * 0.45 + lower * 0.45 + min(motion * 4, 1) * 0.10, 4),
            })
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[:20]


def main() -> None:
    report = {}
    for name, source in SOURCES.items():
        frames = read_video(VIDEO_DIR / source)
        masks = [subject_mask(frame) for frame in frames]
        boxes = [bbox(mask) for mask in masks]
        centers = [(box[0] + box[2]) / 2 for box in boxes if box]
        bottoms = [box[3] for box in boxes if box]
        item = {
            "source": f"videos/{source}",
            "frameCount": len(frames),
            "centerXRange": [min(centers), max(centers)],
            "bottomRange": [min(bottoms), max(bottoms)],
            "sampleBboxes": {str(index): boxes[index] for index in range(0, len(boxes), 10)},
            "neutralIouByTenFrames": {
                str(index): round(iou(masks[0], masks[index]), 4)
                for index in range(0, len(masks), 10)
            },
        }
        if name == "run":
            item["loopCandidates"] = loop_candidates(masks)
        report[name] = item
    out = ROOT / "werewolf-v02-video-measurements.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
