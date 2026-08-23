#!/usr/bin/env python3
"""Measure RedWolfKing H3 run clips without cutting out or changing the video."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import numpy as np
from scipy import ndimage


def decode(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def frame_metrics(frame: np.ndarray) -> dict[str, float | int | list[int]]:
    h, w = frame.shape[:2]
    border = np.concatenate((
        frame[:8].reshape(-1, 3), frame[-8:].reshape(-1, 3),
        frame[:, :8].reshape(-1, 3), frame[:, -8:].reshape(-1, 3),
    ))
    bg = np.median(border, axis=0)
    distance = np.max(np.abs(frame.astype(np.int16) - bg.astype(np.int16)), axis=2)
    subject = distance > 45
    subject = ndimage.binary_opening(subject, structure=np.ones((2, 2)))
    labels, count = ndimage.label(subject)
    if count:
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        subject = labels == int(np.argmax(sizes))
    ys, xs = np.nonzero(subject)
    if not len(xs):
        raise RuntimeError("frame contains no detected subject")
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())

    center_x = (x0 + x1) / 2
    body_w = x1 - x0 + 1
    body_h = y1 - y0 + 1
    torso_x0 = max(0, round(center_x - body_w * 0.20))
    torso_x1 = min(w, round(center_x + body_w * 0.20))
    torso_y1 = min(h, y0 + round(body_h * 0.68))
    torso_mask = subject[y0:torso_y1, torso_x0:torso_x1]
    torso_ys, torso_xs = np.nonzero(torso_mask)
    darkness = 255.0 - frame[y0:torso_y1, torso_x0:torso_x1].mean(axis=2)
    weights = np.maximum(1.0, darkness[torso_ys, torso_xs])
    torso_y = float(np.average(torso_ys + y0, weights=weights))

    safe_bg = ~ndimage.binary_dilation(subject, iterations=6)
    bg_pixels = frame[safe_bg]
    bg_abs_dev = np.max(np.abs(bg_pixels.astype(np.int16) - bg.astype(np.int16)), axis=1)
    brightness = frame.mean(axis=2)
    saturation = frame.max(axis=2).astype(np.int16) - frame.min(axis=2).astype(np.int16)
    gray_patch = safe_bg & (np.indices((h, w))[0] > h * 0.52) & (brightness < 245) & (saturation < 10)
    return {
        "backgroundRgb": [int(value) for value in bg],
        "backgroundMeanAbsDeviation": round(float(bg_abs_dev.mean()), 3),
        "backgroundP99AbsDeviation": round(float(np.percentile(bg_abs_dev, 99)), 3),
        "grayShadowLikePixels": int(gray_patch.sum()),
        "bbox": [x0, y0, x1, y1],
        "headTopY": y0,
        "torsoCentroidY": round(torso_y, 3),
    }


def summarize(path: Path, start: int, end: int) -> dict:
    frames = decode(path)
    selected = [frame_metrics(frame) for frame in frames[start:min(end + 1, len(frames))]]
    torso = np.array([row["torsoCentroidY"] for row in selected], dtype=float)
    tops = np.array([row["headTopY"] for row in selected], dtype=float)
    bg_dev = np.array([row["backgroundMeanAbsDeviation"] for row in selected], dtype=float)
    bg_p99 = np.array([row["backgroundP99AbsDeviation"] for row in selected], dtype=float)
    gray = np.array([row["grayShadowLikePixels"] for row in selected], dtype=int)
    return {
        "video": path.as_posix(),
        "frameCount": len(frames),
        "analyzedRangeInclusive": [start, min(end, len(frames) - 1)],
        "torsoCentroidRangePx": round(float(torso.max() - torso.min()), 3),
        "torsoCentroidStdPx": round(float(torso.std()), 3),
        "headTopRangePx": int(tops.max() - tops.min()),
        "backgroundMeanAbsDeviationMax": round(float(bg_dev.max()), 3),
        "backgroundP99AbsDeviationMax": round(float(bg_p99.max()), 3),
        "grayShadowLikePixelsMax": int(gray.max()),
        "grayShadowLikePixelsMean": round(float(gray.mean()), 3),
        "frames": selected,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--start", type=int, default=34)
    parser.add_argument("--end", type=int, default=100)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = {"clips": [summarize(path, args.start, args.end) for path in args.videos]}
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
