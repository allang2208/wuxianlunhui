#!/usr/bin/env python3
"""Measure the approved RedWolfKing H3 sources against the cyan stage."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
CYAN = np.array([0, 217, 255], dtype=np.float32)

SELECTIONS = {
    "idle": [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
    "running": list(range(44, 60)),
    "attack-bite": [0, 16, 22, 26, 32, 45, 58, 71, 84, 91, 104],
    "pounce": [0, 6, 13, 19, 26, 32, 39, 45, 52, 58, 65, 71],
    "howl": [0, 16, 25, 33, 41, 49, 57, 74, 90, 98, 107, 115],
    "dying": [0, 6, 13, 19, 23, 26, 32, 39, 52, 78, 104, 123],
}


def subject_mask(frame_bgr: np.ndarray) -> np.ndarray:
    rgb = frame_bgr[..., ::-1].astype(np.float32)
    mask = (np.linalg.norm(rgb - CYAN, axis=2) > 48).astype(np.uint8)
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


def iou(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.logical_and(first, second).sum() / max(1, np.logical_or(first, second).sum()))


def leg_iou(first: np.ndarray, second: np.ndarray) -> float:
    ys, _ = np.where(first)
    if not ys.size:
        return 0.0
    y0, y1 = int(ys.min()), int(ys.max())
    cut = max(0, y1 - round((y1 - y0) * 0.35))
    return iou(first[cut:y1 + 1], second[cut:y1 + 1])


def gait_candidates(masks: list[np.ndarray]) -> list[dict[str, float | int]]:
    reference = masks[0]
    diffs = [1.0 - iou(reference, mask) for mask in masks]
    peak = max(diffs)
    active = [index for index, value in enumerate(diffs) if value > peak * 0.10]
    window = (active[0], active[-1])
    candidates = []
    for start in range(max(12, window[0]), min(105, window[1]), 2):
        for period in range(16, 61, 2):
            if start + 2 * period > window[1]:
                continue
            seam = leg_iou(masks[start], masks[start + period])
            if seam < 0.50:
                continue
            sequence = masks[start:start + period]
            smooth = np.mean([leg_iou(sequence[i], sequence[i + 1]) for i in range(len(sequence) - 1)])
            candidates.append({"start": start, "period": period, "seam": seam, "smooth": float(smooth)})
    candidates.sort(key=lambda item: (item["smooth"], item["seam"]), reverse=True)
    return candidates[:10]


def main() -> None:
    report = {}
    for name, selected in SELECTIONS.items():
        path = VIDEO_DIR / f"red-wolf-{name}-h3-v01.mp4"
        frames = read_video(path)
        masks = [subject_mask(frame) for frame in frames]
        boxes = [bbox(mask) for mask in masks]
        selected_boxes = {str(i): boxes[i] for i in selected}
        neutral = boxes[selected[0] if selected else 0]
        scale = 262 / (neutral[3] - neutral[1] + 1)
        report[name] = {
            "video": str(path.relative_to(ROOT)).replace("\\", "/"),
            "frameCount": len(frames),
            "selectedFrames": selected,
            "selectedBboxes": selected_boxes,
            "neutralScaleTo262": scale,
            "sourceCenterXRange": [
                min((box[0] + box[2]) / 2 for box in boxes if box),
                max((box[0] + box[2]) / 2 for box in boxes if box),
            ],
            "sourceBottomRange": [
                min(box[3] for box in boxes if box),
                max(box[3] for box in boxes if box),
            ],
        }
        if name == "running":
            report[name]["gaitCandidates"] = gait_candidates(masks)
    out = ROOT / "source-video-measurements.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
