#!/usr/bin/env python3
"""Build fixed-crop contacts and motion metrics for the approved body actions."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


TASK_ROOT = Path(__file__).resolve().parents[1]
OUT = TASK_ROOT / "animation" / "review-action-windows"
VIDEOS = {
    "snow-sepulcher-carrier-plow-prepare": TASK_ROOT / "animation" / "videos" / "01-snow-sepulcher-carrier-plow-windup-h3-v02.mp4",
    "white-silence-bell-hart-double-toll": TASK_ROOT / "animation" / "videos" / "03-white-silence-bell-hart-double-toll-h3-v01.mp4",
}


def decode(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    rough = np.uint8(distance > 26) * 255
    count, labels, stats, _ = cv2.connectedComponentsWithStats(rough, 8)
    if count <= 1:
        raise RuntimeError("no foreground component")
    order = np.argsort(stats[1:, cv2.CC_STAT_AREA])[::-1] + 1
    largest = int(order[0])
    keep = labels == largest
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    vicinity = (lx - 28, ly - 28, lx + lw + 28, ly + lh + 28)
    for label in order[1:]:
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if int(stats[label, cv2.CC_STAT_AREA]) >= 20 and x < vicinity[2] and x + w > vicinity[0] and y < vicinity[3] and y + h > vicinity[1]:
            keep |= labels == label
    return keep


def bbox(mask: np.ndarray) -> list[int]:
    ys, xs = np.where(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = min(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "white")
    canvas.paste(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return canvas


def analyze(stem: str, video: Path) -> None:
    frames, fps = decode(video)
    masks = [subject_mask(frame) for frame in frames]
    boxes = [bbox(mask) for mask in masks]
    union = np.logical_or.reduce(masks)
    ux0, uy0, ux1, uy1 = bbox(union)
    pad = 20
    ux0, uy0 = max(0, ux0 - pad), max(0, uy0 - pad)
    ux1, uy1 = min(frames[0].shape[1] - 1, ux1 + pad), min(frames[0].shape[0] - 1, uy1 + pad)

    base = frames[0].astype(np.float32)
    entries = []
    for index, (frame, mask, box) in enumerate(zip(frames, masks, boxes)):
        compare = mask | masks[0]
        delta0 = np.abs(frame.astype(np.float32) - base).mean(axis=2)
        if index:
            compare_prev = mask | masks[index - 1]
            delta_prev_map = np.abs(frame.astype(np.float32) - frames[index - 1].astype(np.float32)).mean(axis=2)
            delta_prev = float(delta_prev_map[compare_prev].mean())
        else:
            delta_prev = 0.0
        entries.append({
            "frame": index,
            "bbox": box,
            "centerX": round((box[0] + box[2]) / 2, 3),
            "bottomY": box[3],
            "meanAbsFromStart": round(float(delta0[compare].mean()), 4),
            "meanAbsFromPrevious": round(delta_prev, 4),
        })

    sample_indices = list(range(0, len(frames), 4))
    tile_w, tile_h, label_h, cols = 320, 220, 34, 8
    rows = math.ceil(len(sample_indices) / cols)
    contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for slot, source_index in enumerate(sample_indices):
        crop = Image.fromarray(frames[source_index][uy0:uy1 + 1, ux0:ux1 + 1], "RGB")
        tile = fit(crop, (tile_w, tile_h))
        x = (slot % cols) * tile_w
        y = (slot // cols) * (tile_h + label_h)
        contact.paste(tile, (x, y))
        info = entries[source_index]
        draw.text((x + 5, y + tile_h + 3), f"f{source_index} d0={info['meanAbsFromStart']:.1f} dp={info['meanAbsFromPrevious']:.1f}", fill="white")

    OUT.mkdir(parents=True, exist_ok=True)
    contact.save(OUT / f"{stem}-fixed-crop-contact-step4.png")
    if stem == "white-silence-bell-hart-double-toll":
        # The gameplay event is the physical bell strike, so preserve a
        # dedicated abdomen close-up instead of inferring it from the whole
        # creature silhouette.
        roi = (325, 225, 500, 420)
        bell_indices = list(range(12, 85, 4))
        bell_cols = 7
        bell_tile = (350, 390)
        bell_rows = math.ceil(len(bell_indices) / bell_cols)
        closeup = Image.new(
            "RGB",
            (bell_cols * bell_tile[0], bell_rows * (bell_tile[1] + label_h)),
            "#20242a",
        )
        closeup_draw = ImageDraw.Draw(closeup)
        for slot, source_index in enumerate(bell_indices):
            crop = Image.fromarray(frames[source_index][roi[1]:roi[3], roi[0]:roi[2]], "RGB")
            tile = fit(crop, bell_tile)
            x = (slot % bell_cols) * bell_tile[0]
            y = (slot // bell_cols) * (bell_tile[1] + label_h)
            closeup.paste(tile, (x, y))
            closeup_draw.text((x + 5, y + bell_tile[1] + 3), f"source f{source_index}", fill="white")
        closeup.save(OUT / f"{stem}-bell-closeup-f12-f84-step4.png")
    report = {
        "video": str(video.relative_to(TASK_ROOT)).replace("\\", "/"),
        "decodedFrameCount": len(frames),
        "fps": fps,
        "fixedReviewCrop": [ux0, uy0, ux1, uy1],
        "frames": entries,
    }
    (OUT / f"{stem}-motion-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[action-window] {stem}: frames={len(frames)} fps={fps} crop={[ux0, uy0, ux1, uy1]}")


def main() -> None:
    for stem, video in VIDEOS.items():
        analyze(stem, video)


if __name__ == "__main__":
    main()
