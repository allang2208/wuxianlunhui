#!/usr/bin/env python3
"""Audit Hollow Ovum H3 originals for heading, scale, root drift, and topology."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


TASK = Path(__file__).resolve().parent
VIDEOS = TASK / "videos"
AUDIT = TASK / "audit"
SAMPLES = [0, 16, 32, 48, 64, 80, 96, 112, 123]
ACTIONS = [
    ("idle", "hollow-ovum-idle-v01.mp4"),
    ("hover_motion", "hollow-ovum-hover-motion-v01.mp4"),
    ("vacuum_draw", "hollow-ovum-vacuum-draw-v02.mp4"),
    ("shell_pulse", "hollow-ovum-shell-pulse-v01.mp4"),
    ("collapse", "hollow-ovum-collapse-v01.mp4"),
]


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    frames = [np.asarray(frame.to_image().convert("RGB")) for frame in container.decode(stream)]
    container.close()
    return frames


def foreground_component(rgb: np.ndarray) -> np.ndarray:
    delta = 255.0 - rgb.astype(np.float32)
    distance = np.sqrt(np.square(delta).sum(axis=2))
    raw = (distance > 22.0).astype(np.uint8)
    raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, connectivity=8)
    candidates: list[tuple[int, int]] = []
    for label in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[label])
        if height >= 80 and width >= 45 and area >= 1500 and height / max(width, 1) < 4.0:
            candidates.append((area, label))
    if not candidates:
        raise RuntimeError("no subject component detected")
    label = max(candidates)[1]
    return (labels == label).astype(np.uint8)


def central_hole_area(mask: np.ndarray) -> int:
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    inverse = (1 - closed).astype(np.uint8)
    padded = cv2.copyMakeBorder(inverse, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    flood = padded.copy()
    flood_mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 2)
    enclosed = ((padded == 1) & (flood != 2)).astype(np.uint8)[1:-1, 1:-1]
    count, _, stats, _ = cv2.connectedComponentsWithStats(enclosed, connectivity=8)
    if count <= 1:
        return 0
    areas = [int(stats[label, cv2.CC_STAT_AREA]) for label in range(1, count)]
    return max(areas, default=0)


def metrics(rgb: np.ndarray) -> tuple[dict[str, float | int], np.ndarray]:
    mask = foreground_component(rgb)
    ys, xs = np.where(mask > 0)
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    coords = np.column_stack((xs.astype(np.float64), ys.astype(np.float64)))
    centered = coords - coords.mean(axis=0, keepdims=True)
    covariance = np.cov(centered, rowvar=False)
    values, vectors = np.linalg.eigh(covariance)
    order = np.argsort(values)[::-1]
    values = values[order]
    vector = vectors[:, order[0]]
    angle = math.degrees(math.atan2(float(vector[0]), float(vector[1])))
    while angle > 90.0:
        angle -= 180.0
    while angle < -90.0:
        angle += 180.0
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "width": right - left,
        "height": bottom - top,
        "area": int(mask.sum()),
        "centerX": round(float(xs.mean()), 3),
        "centerY": round(float(ys.mean()), 3),
        "bottomCenterX": round((left + right) / 2.0, 3),
        "principalAngleFromVertical": round(angle, 3),
        "principalElongation": round(float(values[0] / max(values[1], 1e-9)), 3),
        "centralHoleArea": central_hole_area(mask),
    }, mask


def extreme(entries: list[dict], key: str, mode: str) -> dict:
    chooser = min if mode == "min" else max
    return chooser(entries, key=lambda entry: float(entry[key]))


def main() -> None:
    AUDIT.mkdir(parents=True, exist_ok=True)
    keyframes = AUDIT / "keyframes"
    keyframes.mkdir(exist_ok=True)
    report = {
        "task": "空腔之卵朝向、大小与模型形变复查",
        "method": {
            "source": "accepted original H3 MP4 files",
            "frameCoverage": "all 124 decoded frames per action",
            "subjectMask": "largest non-white connected component; ground shadow excluded",
            "angle": "foreground principal axis relative to screen vertical; near-circular peak poses have low directional reliability",
            "hole": "largest enclosed white region after a 7px close; used as a warning signal and confirmed manually at keyframes",
        },
        "actions": {},
    }

    thumb_w, thumb_h = 256, 144
    label_h, row_label_w = 50, 150
    overview = Image.new(
        "RGB",
        (row_label_w + thumb_w * len(SAMPLES), (thumb_h + label_h) * len(ACTIONS)),
        (17, 19, 23),
    )
    draw = ImageDraw.Draw(overview)
    font = ImageFont.load_default()

    for row, (action, filename) in enumerate(ACTIONS):
        frames = decode(VIDEOS / filename)
        if len(frames) != 124:
            raise RuntimeError(f"{filename}: expected 124 frames, got {len(frames)}")
        entries: list[dict] = []
        masks: list[np.ndarray] = []
        for index, rgb in enumerate(frames):
            entry, mask = metrics(rgb)
            entry["frame"] = index
            entries.append(entry)
            masks.append(mask)
        baseline = entries[0]
        for entry in entries:
            entry["widthRatio"] = round(entry["width"] / baseline["width"], 4)
            entry["heightRatio"] = round(entry["height"] / baseline["height"], 4)
            entry["areaRatio"] = round(entry["area"] / baseline["area"], 4)
            entry["centerDeltaX"] = round(entry["centerX"] - baseline["centerX"], 3)
            entry["centerDeltaY"] = round(entry["centerY"] - baseline["centerY"], 3)
            entry["bottomCenterDeltaX"] = round(
                entry["bottomCenterX"] - baseline["bottomCenterX"], 3
            )
            entry["holeRatio"] = round(
                entry["centralHoleArea"] / max(baseline["centralHoleArea"], 1), 4
            )

        summary = {
            "video": f"videos/{filename}",
            "baseline": baseline,
            "widthRatio": {
                "min": extreme(entries, "widthRatio", "min"),
                "max": extreme(entries, "widthRatio", "max"),
            },
            "heightRatio": {
                "min": extreme(entries, "heightRatio", "min"),
                "max": extreme(entries, "heightRatio", "max"),
            },
            "areaRatio": {
                "min": extreme(entries, "areaRatio", "min"),
                "max": extreme(entries, "areaRatio", "max"),
            },
            "centerDeltaX": {
                "min": extreme(entries, "centerDeltaX", "min"),
                "max": extreme(entries, "centerDeltaX", "max"),
            },
            "bottomCenterDeltaX": {
                "min": extreme(entries, "bottomCenterDeltaX", "min"),
                "max": extreme(entries, "bottomCenterDeltaX", "max"),
            },
            "principalAngle": {
                "min": extreme(entries, "principalAngleFromVertical", "min"),
                "max": extreme(entries, "principalAngleFromVertical", "max"),
            },
            "centralHoleArea": {
                "min": extreme(entries, "centralHoleArea", "min"),
                "max": extreme(entries, "centralHoleArea", "max"),
            },
            "perFrame": entries,
        }
        report["actions"][action] = summary

        selected = {
            0,
            123,
            int(summary["widthRatio"]["min"]["frame"]),
            int(summary["widthRatio"]["max"]["frame"]),
            int(summary["heightRatio"]["min"]["frame"]),
            int(summary["heightRatio"]["max"]["frame"]),
            int(summary["centralHoleArea"]["min"]["frame"]),
            int(summary["centralHoleArea"]["max"]["frame"]),
            int(summary["principalAngle"]["min"]["frame"]),
            int(summary["principalAngle"]["max"]["frame"]),
        }
        for index in sorted(selected):
            Image.fromarray(frames[index]).save(keyframes / f"{action}-frame-{index:03d}.png")

        y = row * (thumb_h + label_h)
        draw.text((10, y + 12), action, fill=(238, 240, 245), font=font)
        for column, index in enumerate(SAMPLES):
            entry = entries[index]
            image = Image.fromarray(frames[index]).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            x = row_label_w + column * thumb_w
            overview.paste(image, (x, y))
            scale_x, scale_y = thumb_w / frames[index].shape[1], thumb_h / frames[index].shape[0]
            draw.rectangle(
                (
                    x + entry["left"] * scale_x,
                    y + entry["top"] * scale_y,
                    x + entry["right"] * scale_x,
                    y + entry["bottom"] * scale_y,
                ),
                outline=(35, 214, 140),
                width=1,
            )
            text_y = y + thumb_h + 2
            draw.text(
                (x + 4, text_y),
                f"f{index} w{entry['widthRatio']:.2f} h{entry['heightRatio']:.2f}",
                fill=(225, 228, 234),
                font=font,
            )
            draw.text(
                (x + 4, text_y + 16),
                f"dx{entry['centerDeltaX']:+.0f} a{entry['principalAngleFromVertical']:+.0f} hole{entry['holeRatio']:.2f}",
                fill=(185, 190, 201),
                font=font,
            )

    overview_path = AUDIT / "orientation-size-deformation-overview.png"
    overview.save(overview_path)
    report["overview"] = str(overview_path.relative_to(TASK)).replace("\\", "/")
    report_path = AUDIT / "orientation-size-deformation-audit.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(report_path)
    print(overview_path)


if __name__ == "__main__":
    main()
