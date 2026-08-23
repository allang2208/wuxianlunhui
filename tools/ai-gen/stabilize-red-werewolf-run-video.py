#!/usr/bin/env python3
"""Remove whole-body vertical bob from a white-background H3 running clip."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import cv2
import numpy as np
from scipy import ndimage
from scipy.signal import savgol_filter


def subject_mask(frame: np.ndarray) -> np.ndarray:
    distance = np.max(np.abs(frame.astype(np.int16) - 255), axis=2)
    mask = ndimage.binary_opening(distance > 45, structure=np.ones((2, 2)))
    labels, count = ndimage.label(mask)
    if not count:
        raise RuntimeError("frame contains no detected subject")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(np.argmax(sizes))


def torso_centroid(frame: np.ndarray, mask: np.ndarray) -> float:
    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    center_x = (x0 + x1) / 2
    body_w = x1 - x0 + 1
    body_h = y1 - y0 + 1
    tx0 = max(0, round(center_x - body_w * 0.20))
    tx1 = min(frame.shape[1], round(center_x + body_w * 0.20))
    ty1 = min(frame.shape[0], y0 + round(body_h * 0.68))
    torso = mask[y0:ty1, tx0:tx1]
    torso_ys, torso_xs = np.nonzero(torso)
    darkness = 255.0 - frame[y0:ty1, tx0:tx1].mean(axis=2)
    weights = np.maximum(1.0, darkness[torso_ys, torso_xs])
    return float(np.average(torso_ys + y0, weights=weights))


def clean_white_background(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    output = frame.copy()
    protected = ndimage.binary_dilation(mask, iterations=5)
    saturation = output.max(axis=2).astype(np.int16) - output.min(axis=2).astype(np.int16)
    gray_artifact = ~protected & (saturation < 12) & (output.min(axis=2) < 250)
    output[gray_artifact] = 255
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--window", type=int, default=9)
    args = parser.parse_args()

    with av.open(str(args.video)) as container:
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    masks = [subject_mask(frame) for frame in frames]
    raw = np.array([torso_centroid(frame, mask) for frame, mask in zip(frames, masks, strict=True)])
    window = min(args.window, len(frames) if len(frames) % 2 else len(frames) - 1)
    if window < 5:
        raise RuntimeError("clip is too short for stabilization")
    if window % 2 == 0:
        window -= 1
    trajectory = savgol_filter(raw, window_length=window, polyorder=2, mode="wrap")
    target = float((trajectory[0] + trajectory[-1]) / 2)
    shifts = target - trajectory
    # Preserve the exact authored loop phase: both endpoint frames receive the
    # same zero translation, while the tiny endpoint mismatch is distributed
    # over the full five-second clip instead of becoming a visible wrap jump.
    shifts -= np.linspace(float(shifts[0]), float(shifts[-1]), len(shifts))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    h, w = frames[0].shape[:2]
    with av.open(str(args.out), mode="w") as output:
        stream = output.add_stream("libx264", rate=24)
        stream.width = w
        stream.height = h
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": "15", "preset": "slow"}
        for frame, mask, dy in zip(frames, masks, shifts, strict=True):
            clean = clean_white_background(frame, mask)
            matrix = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, float(dy)]], dtype=np.float32)
            moved = cv2.warpAffine(
                clean, matrix, (w, h), flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
            )
            packet_frame = av.VideoFrame.from_ndarray(moved, format="rgb24")
            for packet in stream.encode(packet_frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)

    report = {
        "source": args.video.as_posix(),
        "output": args.out.as_posix(),
        "frameCount": len(frames),
        "fps": 24,
        "trajectoryWindow": window,
        "targetTorsoCentroidY": round(target, 4),
        "rawTorsoRangePx": round(float(raw.max() - raw.min()), 4),
        "smoothedTrajectoryRangePx": round(float(trajectory.max() - trajectory.min()), 4),
        "shiftRangePx": [round(float(shifts.min()), 4), round(float(shifts.max()), 4)],
        "endpointShiftsPx": [round(float(shifts[0]), 4), round(float(shifts[-1]), 4)],
    }
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
