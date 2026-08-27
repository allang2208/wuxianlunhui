#!/usr/bin/env python3
"""Rank same-phase loop windows from native consecutive running frames."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "running-doubao-v02.mp4"
OUT = ROOT / "previews" / "diagnostics" / "loop-v03"
SEARCH_START = 20
SEARCH_END = 101
MIN_PERIOD = 12
MAX_PERIOD = 30
CANVAS = 512
TARGET_HEIGHT = 360


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    darkness = 255 - rgb.astype(np.int16).mean(axis=2)
    chroma = rgb.astype(np.int16).max(axis=2) - rgb.astype(np.int16).min(axis=2)
    mask = ((darkness > 26) | ((darkness > 16) & (chroma > 18))).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("No foreground component")
    candidates = []
    height, width = mask.shape
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if x < width * 0.85 and y < height * 0.85:
            candidates.append((int(area), label))
    label = max(candidates)[1]
    keep = (labels == label).astype(np.uint8)
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return keep


def normalize(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = subject_mask(rgb)
    ys, xs = np.where(mask > 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop_rgb = rgb[y0:y1 + 1, x0:x1 + 1]
    crop_mask = mask[y0:y1 + 1, x0:x1 + 1]
    scale = TARGET_HEIGHT / crop_mask.shape[0]
    target_w = max(1, round(crop_mask.shape[1] * scale))
    target_h = TARGET_HEIGHT
    if target_w > CANVAS - 24:
        scale = (CANVAS - 24) / crop_mask.shape[1]
        target_w = CANVAS - 24
        target_h = max(1, round(crop_mask.shape[0] * scale))
    resized_rgb = cv2.resize(crop_rgb, (target_w, target_h), interpolation=cv2.INTER_AREA)
    resized_mask = cv2.resize(crop_mask, (target_w, target_h), interpolation=cv2.INTER_NEAREST)
    canvas_rgb = np.full((CANVAS, CANVAS, 3), 255, np.uint8)
    canvas_mask = np.zeros((CANVAS, CANVAS), np.uint8)
    x = (CANVAS - target_w) // 2
    y = CANVAS - 40 - target_h
    canvas_rgb[y:y + target_h, x:x + target_w] = resized_rgb
    canvas_mask[y:y + target_h, x:x + target_w] = resized_mask
    return canvas_rgb, canvas_mask


def compare(left: tuple[np.ndarray, np.ndarray], right: tuple[np.ndarray, np.ndarray]) -> dict[str, float]:
    left_rgb, left_mask = left
    right_rgb, right_mask = right
    union = np.logical_or(left_mask, right_mask)
    intersection = np.logical_and(left_mask, right_mask)
    overall_iou = float(intersection.sum() / union.sum())

    ys, _ = np.where(union)
    leg_top = int(ys.min() + (ys.max() - ys.min() + 1) * 0.64)
    leg_union = union[leg_top:]
    leg_intersection = intersection[leg_top:]
    leg_iou = float(leg_intersection.sum() / leg_union.sum()) if leg_union.any() else 0.0

    delta = np.abs(left_rgb.astype(np.float32) - right_rgb.astype(np.float32)).mean(axis=2)
    visible_delta = float(delta[union].mean())
    score = leg_iou * 2.2 + overall_iou - visible_delta / 100.0
    return {
        "overallIou": overall_iou,
        "legIou": leg_iou,
        "visibleDelta": visible_delta,
        "score": score,
    }


def save_candidate_contacts(
    frames: list[np.ndarray], fps: float, candidates: list[dict[str, object]]
) -> None:
    thumb_w, thumb_h, label_h = 320, 180, 26
    for rank, candidate in enumerate(candidates[:5], 1):
        start = int(candidate["start"])
        end = int(candidate["end"])
        indices = list(range(start, end + 1))
        cols = 5
        rows = math.ceil(len(indices) / cols)
        contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
        draw = ImageDraw.Draw(contact)
        for position, index in enumerate(indices):
            image = Image.fromarray(frames[index], "RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            x = position % cols * thumb_w
            y = position // cols * (thumb_h + label_h)
            contact.paste(image, (x, y))
            suffix = " start" if index == start else (" same-phase end" if index == end else "")
            draw.text((x + 5, y + thumb_h + 4), f"f{index} {index / fps:.3f}s{suffix}", fill="white")
        contact.save(OUT / f"rank-{rank:02d}-f{start}-f{end}.jpg", quality=94)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    frames, fps = decode()
    normalized = {index: normalize(frames[index]) for index in range(SEARCH_START, SEARCH_END)}
    candidates = []
    for start in range(SEARCH_START, SEARCH_END - MIN_PERIOD):
        for period in range(MIN_PERIOD, MAX_PERIOD + 1):
            end = start + period
            if end >= SEARCH_END:
                continue
            metrics = compare(normalized[start], normalized[end])
            candidates.append({"start": start, "end": end, "period": period, **metrics})
    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    save_candidate_contacts(frames, fps, candidates)
    report = {
        "video": str(VIDEO),
        "fps": fps,
        "method": "largest subject component normalized to fixed height and footline; rank by lower-36-percent leg IoU, whole-subject IoU and visible RGB delta",
        "topCandidates": candidates[:30],
    }
    (OUT / "loop-candidate-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["topCandidates"][:10], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
