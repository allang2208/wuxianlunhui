#!/usr/bin/env python3
"""Compare raw antler-action screen-space anchors without altering either video."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEOS = ROOT / "videos"
SOURCES = {
    "v01_user_rejected_camera_drift": VIDEOS / "03-white-silence-bell-hart-antler-body-h3-v01.mp4",
    "v02_fixed_canvas_candidate": VIDEOS / "03-white-silence-bell-hart-antler-body-h3-v02.mp4",
    "v03_hoof_registered_candidate": VIDEOS / "03-white-silence-bell-hart-antler-body-h3-v03.mp4",
    "v04_background_registered_candidate": VIDEOS / "03-white-silence-bell-hart-antler-body-h3-v04.mp4",
}
SAMPLES = [0, 16, 24, 32, 40, 48, 56, 64, 72, 84, 100, 123]


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    frames = [np.asarray(frame.to_image().convert("RGB")) for frame in container.decode(stream)]
    container.close()
    return frames


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    distance = np.linalg.norm(255.0 - rgb.astype(np.float32), axis=2)
    raw = (distance > 24.0).astype(np.uint8)
    # v04 adds fixed registration marks only in the empty outer/background band.
    # Exclude that band from subject measurement without transforming any frame.
    raw[:80, :] = 0
    raw[530:, :] = 0
    raw[:, :100] = 0
    raw[:, 924:] = 0
    raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    candidates = []
    for label in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[label])
        if area >= 24 and 180 <= x + width // 2 <= 820 and 20 <= y <= 550:
            candidates.append((area, label))
    if not candidates:
        raise RuntimeError("no foreground component")
    largest = max(candidates)[1]
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    width = int(stats[largest, cv2.CC_STAT_WIDTH])
    height = int(stats[largest, cv2.CC_STAT_HEIGHT])
    keep = np.zeros_like(raw, dtype=bool)
    for _area, label in candidates:
        lx = int(stats[label, cv2.CC_STAT_LEFT])
        ly = int(stats[label, cv2.CC_STAT_TOP])
        lw = int(stats[label, cv2.CC_STAT_WIDTH])
        lh = int(stats[label, cv2.CC_STAT_HEIGHT])
        if lx < x + width + 24 and lx + lw > x - 24 and ly < y + height + 24 and ly + lh > y - 24:
            keep |= labels == label
    return keep.astype(np.uint8)


def frame_metrics(rgb: np.ndarray) -> dict:
    mask = subject_mask(rgb)
    ys, xs = np.where(mask > 0)
    left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    height = bottom - top + 1
    torso_top = top + round(height * 0.38)
    torso_bottom = top + round(height * 0.68)
    torso_ys, torso_xs = np.where(mask[torso_top:torso_bottom + 1] > 0)
    root_x = float(np.median(torso_xs)) if len(torso_xs) else float(np.median(xs))

    strip_top = max(top, bottom - max(20, round(height * 0.10)))
    strip = mask[strip_top:bottom + 1]
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(strip, 8)
    feet = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height_part = int(stats[label, cv2.CC_STAT_HEIGHT])
        if area >= 4 and width >= 2 and height_part >= 2:
            feet.append(round(float(centroids[label][0]), 2))
    feet.sort()
    return {
        "bbox": [left, top, right, bottom],
        "width": right - left + 1,
        "height": height,
        "area": int(mask.sum()),
        "centerX": round(float(xs.mean()), 2),
        "rootX": round(root_x, 2),
        "footXs": feet,
        "rearFootX": feet[0] if feet else None,
        "mask": mask,
    }


def main() -> None:
    reports = {}
    decoded = {key: decode(path) for key, path in SOURCES.items()}
    for key, frames in decoded.items():
        entries = []
        for index, frame in enumerate(frames):
            entry = frame_metrics(frame)
            entry.pop("mask")
            entry["frame"] = index
            entries.append(entry)
        baseline = entries[0]
        for entry in entries:
            entry["rootDeltaX"] = round(entry["rootX"] - baseline["rootX"], 2)
            entry["rearFootDeltaX"] = (
                round(entry["rearFootX"] - baseline["rearFootX"], 2)
                if entry["rearFootX"] is not None and baseline["rearFootX"] is not None
                else None
            )
            entry["heightRatio"] = round(entry["height"] / baseline["height"], 4)
            entry["areaRatio"] = round(entry["area"] / baseline["area"], 4)
        active = entries[:105]
        reports[key] = {
            "video": str(SOURCES[key].relative_to(ROOT)).replace("\\", "/"),
            "baseline": baseline,
            "activeWindow0To104": {
                "rootDeltaXRange": [min(e["rootDeltaX"] for e in active), max(e["rootDeltaX"] for e in active)],
                "rearFootDeltaXRange": [
                    min(e["rearFootDeltaX"] for e in active if e["rearFootDeltaX"] is not None),
                    max(e["rearFootDeltaX"] for e in active if e["rearFootDeltaX"] is not None),
                ],
                "heightRatioRange": [min(e["heightRatio"] for e in active), max(e["heightRatio"] for e in active)],
                "areaRatioRange": [min(e["areaRatio"] for e in active), max(e["areaRatio"] for e in active)],
            },
            "samples": [entries[index] for index in SAMPLES],
        }

    thumb_w, thumb_h, label_h = 256, 144, 44
    canvas = Image.new("RGB", (len(SAMPLES) * thumb_w, len(SOURCES) * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(canvas)
    for row, (key, frames) in enumerate(decoded.items()):
        base = reports[key]["baseline"]
        for col, index in enumerate(SAMPLES):
            entry = reports[key]["samples"][col]
            tile = Image.fromarray(frames[index]).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            x = col * thumb_w
            y = row * (thumb_h + label_h)
            canvas.paste(tile, (x, y))
            sx, sy = thumb_w / frames[index].shape[1], thumb_h / frames[index].shape[0]
            bx0, by0, bx1, by1 = entry["bbox"]
            draw.rectangle((x + bx0 * sx, y + by0 * sy, x + bx1 * sx, y + by1 * sy), outline="#35d6a0")
            draw.line((x + base["rootX"] * sx, y, x + base["rootX"] * sx, y + thumb_h), fill="#ff4f64")
            draw.line((x + entry["rootX"] * sx, y, x + entry["rootX"] * sx, y + thumb_h), fill="#33aaff")
            draw.text((x + 4, y + thumb_h + 2), f"{key[:3]} f{index} root {entry['rootDeltaX']:+.0f}px", fill="white")
            draw.text((x + 4, y + thumb_h + 19), f"rear {entry['rearFootDeltaX']:+.0f}px h {entry['heightRatio']:.2f}", fill="#c5ccd6")
    output_image = VIDEOS / "03-white-silence-bell-hart-antler-body-camera-audit.png"
    output_json = VIDEOS / "03-white-silence-bell-hart-antler-body-camera-audit.json"
    canvas.save(output_image)
    output_json.write_text(
        json.dumps(
            {
                "method": "raw-video non-white silhouette; red line is opening torso-root anchor and blue line is current torso-root anchor; no frame is transformed",
                "reports": reports,
                "contact": str(output_image.relative_to(ROOT)).replace("\\", "/"),
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(output_json)
    print(output_image)


if __name__ == "__main__":
    main()
