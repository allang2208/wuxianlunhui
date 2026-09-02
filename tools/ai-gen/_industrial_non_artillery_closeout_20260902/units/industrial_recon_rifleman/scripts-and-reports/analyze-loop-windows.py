#!/usr/bin/env python3
"""Rank same-pose loop endpoints for the approved idle and running videos."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


def decode(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24.0)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    darkness = 255 - rgb.astype(np.int16).mean(axis=2)
    chroma = rgb.astype(np.int16).max(axis=2) - rgb.astype(np.int16).min(axis=2)
    mask = ((darkness > 28) | ((darkness > 17) & (chroma > 19))).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    candidates = []
    height, width = mask.shape
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if area > 500 and x < width * 0.82 and y < height * 0.82:
            candidates.append((int(area), label))
    if not candidates:
        raise RuntimeError("No subject component")
    label = max(candidates)[1]
    keep = (labels == label).astype(np.uint8)
    return cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def normalize(rgb: np.ndarray, canvas: int = 512, target_h: int = 360) -> tuple[np.ndarray, np.ndarray]:
    mask = subject_mask(rgb)
    ys, xs = np.where(mask > 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop_rgb = rgb[y0:y1 + 1, x0:x1 + 1]
    crop_mask = mask[y0:y1 + 1, x0:x1 + 1]
    scale = target_h / crop_mask.shape[0]
    width = max(1, round(crop_mask.shape[1] * scale))
    height = target_h
    if width > canvas - 24:
        scale = (canvas - 24) / crop_mask.shape[1]
        width = canvas - 24
        height = max(1, round(crop_mask.shape[0] * scale))
    resized_rgb = cv2.resize(crop_rgb, (width, height), interpolation=cv2.INTER_AREA)
    resized_mask = cv2.resize(crop_mask, (width, height), interpolation=cv2.INTER_NEAREST)
    out_rgb = np.full((canvas, canvas, 3), 255, np.uint8)
    out_mask = np.zeros((canvas, canvas), np.uint8)
    x = (canvas - width) // 2
    y = canvas - 36 - height
    out_rgb[y:y + height, x:x + width] = resized_rgb
    out_mask[y:y + height, x:x + width] = resized_mask
    return out_rgb, out_mask


def compare(left: tuple[np.ndarray, np.ndarray], right: tuple[np.ndarray, np.ndarray]) -> dict[str, float]:
    left_rgb, left_mask = left
    right_rgb, right_mask = right
    union = np.logical_or(left_mask, right_mask)
    intersection = np.logical_and(left_mask, right_mask)
    overall_iou = float(intersection.sum() / max(1, union.sum()))
    ys, _ = np.where(union)
    lower_top = int(ys.min() + (ys.max() - ys.min() + 1) * 0.64)
    lower_union = union[lower_top:]
    lower_iou = float(
        np.logical_and(left_mask[lower_top:], right_mask[lower_top:]).sum()
        / max(1, lower_union.sum())
    )
    delta = np.abs(left_rgb.astype(np.float32) - right_rgb.astype(np.float32)).mean(axis=2)
    visible_delta = float(delta[union].mean())
    score = lower_iou * 2.4 + overall_iou - visible_delta / 90.0
    return {
        "overallIou": overall_iou,
        "lowerBodyIou": lower_iou,
        "visibleDelta": visible_delta,
        "score": score,
    }


def contact(frames: list[np.ndarray], fps: float, candidate: dict[str, object], out: Path) -> None:
    start = int(candidate["start"])
    endpoint = int(candidate["endpoint"])
    period = endpoint - start
    sample_count = min(16, period + 1)
    indices = sorted(set(round(start + i * period / (sample_count - 1)) for i in range(sample_count)))
    thumb_w, thumb_h, label_h, cols = 320, 180, 24, 4
    rows = math.ceil(len(indices) / cols)
    sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(sheet)
    for position, index in enumerate(indices):
        image = Image.fromarray(frames[index], "RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = position % cols * thumb_w
        y = position // cols * (thumb_h + label_h)
        sheet.paste(image, (x, y))
        suffix = " start" if index == start else (" duplicate endpoint" if index == endpoint else "")
        draw.text((x + 5, y + thumb_h + 4), f"f{index} / {index / fps:.3f}s{suffix}", fill="white")
    sheet.save(out, quality=94)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--search-start", type=int, required=True)
    parser.add_argument("--search-end", type=int, required=True)
    parser.add_argument("--min-period", type=int, required=True)
    parser.add_argument("--max-period", type=int, required=True)
    parser.add_argument("--stem", required=True)
    args = parser.parse_args()

    frames, fps = decode(args.video)
    end = min(args.search_end, len(frames))
    normalized = {index: normalize(frames[index]) for index in range(args.search_start, end)}
    candidates: list[dict[str, object]] = []
    for start in range(args.search_start, end - args.min_period):
        for period in range(args.min_period, args.max_period + 1):
            endpoint = start + period
            if endpoint >= end:
                continue
            candidates.append({
                "start": start,
                "endpoint": endpoint,
                "period": period,
                **compare(normalized[start], normalized[endpoint]),
            })
    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for rank, candidate in enumerate(candidates[:5], 1):
        contact(frames, fps, candidate, args.out_dir / f"{args.stem}-rank-{rank:02d}.jpg")
    report = {
        "video": str(args.video),
        "fps": fps,
        "sourceFrames": len(frames),
        "search": {
            "start": args.search_start,
            "endExclusive": end,
            "minPeriod": args.min_period,
            "maxPeriod": args.max_period,
        },
        "method": "largest non-white subject component normalized to fixed height and footline; lower-body IoU weighted above whole-subject IoU and visible RGB delta",
        "topCandidates": candidates[:30],
    }
    (args.out_dir / f"{args.stem}-loop-candidates.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(candidates[:10], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
