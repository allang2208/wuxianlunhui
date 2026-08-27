#!/usr/bin/env python3
"""Normalize global scale drift in the rejected v01 pounce for H3 motion reference only."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "werewolf-pounce-h3-v01.mp4"
OUTPUT = ROOT / "references" / "werewolf-pounce-v01-scale-normalized-motion.mp4"
REPORT = ROOT / "references" / "werewolf-pounce-v01-scale-normalized-motion.json"
PREVIEW_DIR = ROOT / "previews" / "motion-reference"
CYAN_BGR = np.array([255, 229, 0], dtype=np.uint8)


def subject_mask(frame: np.ndarray) -> np.ndarray:
    rgb = frame[..., ::-1].astype(np.float32)
    mask = (np.linalg.norm(rgb - np.array([0, 229, 255], dtype=np.float32), axis=2) > 52).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("no subject component")
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == keep).astype(np.uint8)


def measure(mask: np.ndarray) -> tuple[tuple[int, int, int, int], float]:
    ys, xs = np.where(mask)
    box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    thickness = float(np.percentile(distance[mask > 0], 95))
    return box, thickness


def main() -> None:
    cap = cv2.VideoCapture(str(SOURCE))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise RuntimeError(f"no frames decoded from {SOURCE}")

    masks = [subject_mask(frame) for frame in frames]
    measured = [measure(mask) for mask in masks]
    boxes = [item[0] for item in measured]
    thickness = np.array([item[1] for item in measured], dtype=np.float64)
    neutral = np.concatenate([thickness[:16], thickness[-16:]])
    target = float(np.median(neutral))
    raw_scales = np.clip(target / np.maximum(thickness, 1e-6), 0.62, 1.08)
    scales = gaussian_filter1d(raw_scales, sigma=2.0, mode="nearest")

    height, width = frames[0].shape[:2]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(OUTPUT), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError(f"cannot open output writer: {OUTPUT}")

    normalized_metrics = []
    output_frames = []
    for frame, mask, box, scale in zip(frames, masks, boxes, scales):
        x0, y0, x1, y1 = box
        crop = frame[y0:y1 + 1, x0:x1 + 1]
        mask_crop = mask[y0:y1 + 1, x0:x1 + 1]
        new_w = max(1, round(crop.shape[1] * float(scale)))
        new_h = max(1, round(crop.shape[0] * float(scale)))
        resized = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
        resized_mask = cv2.resize(mask_crop, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        cx = (x0 + x1) / 2.0
        cy = (y0 + y1) / 2.0
        ox = round(cx - new_w / 2.0)
        oy = round(cy - new_h / 2.0)
        ox = max(0, min(ox, width - new_w))
        oy = max(0, min(oy, height - new_h))
        out = np.empty_like(frame)
        out[:] = CYAN_BGR
        alpha = np.clip(resized_mask.astype(np.float32), 0.0, 1.0)[..., None]
        roi = out[oy:oy + new_h, ox:ox + new_w].astype(np.float32)
        out[oy:oy + new_h, ox:ox + new_w] = np.clip(
            resized.astype(np.float32) * alpha + roi * (1.0 - alpha), 0, 255
        ).astype(np.uint8)
        writer.write(out)
        output_frames.append(out.copy())
        _, metric = measure(subject_mask(out))
        normalized_metrics.append(metric)
    writer.release()

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    gif_frames = [
        Image.fromarray(frame[..., ::-1]).resize((512, 288), Image.Resampling.LANCZOS)
        for frame in output_frames[::2]
    ]
    gif_frames[0].save(
        PREVIEW_DIR / "werewolf-pounce-v01-scale-normalized-motion.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(2000 / fps),
        loop=0,
        disposal=2,
    )
    indices = list(range(0, len(output_frames), 6))
    if indices[-1] != len(output_frames) - 1:
        indices.append(len(output_frames) - 1)
    cols = 4
    contact = Image.new("RGB", (1280, math.ceil(len(indices) / cols) * 204), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        tile = Image.fromarray(output_frames[index][..., ::-1]).resize((320, 180), Image.Resampling.LANCZOS)
        x = position % cols * 320
        y = position // cols * 204
        contact.paste(tile, (x, y))
        draw.text((x + 5, y + 184), f"source f{index} / {index / fps:.2f}s", fill="white")
    contact.save(PREVIEW_DIR / "werewolf-pounce-v01-scale-normalized-motion-contact.png")

    report = {
        "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "output": str(OUTPUT.relative_to(ROOT)).replace("\\", "/"),
        "purpose": "H3 motion reference only; never a runtime animation source",
        "frameCount": len(frames),
        "fps": fps,
        "scaleMetric": "largest-component distance-transform p95",
        "targetThickness": target,
        "sourceThicknessRange": [float(thickness.min()), float(thickness.max())],
        "appliedScaleRange": [float(scales.min()), float(scales.max())],
        "normalizedThicknessRange": [float(min(normalized_metrics)), float(max(normalized_metrics))],
        "previewGif": "previews/motion-reference/werewolf-pounce-v01-scale-normalized-motion.gif",
        "contact": "previews/motion-reference/werewolf-pounce-v01-scale-normalized-motion-contact.png",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
