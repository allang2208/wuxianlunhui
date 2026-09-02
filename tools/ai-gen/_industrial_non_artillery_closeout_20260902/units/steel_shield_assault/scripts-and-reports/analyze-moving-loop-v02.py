#!/usr/bin/env python3
"""Find same-leg loop candidates in the approved steel-shield moving v02 source."""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "moving-doubao-v02-coat-covered.mp4"
OUT_DIR = ROOT / "previews" / "moving-loop-analysis-v02"


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def character_mask(frame: np.ndarray) -> np.ndarray:
    margin = 16
    border = np.concatenate((
        frame[:margin].reshape(-1, 3),
        frame[-margin:].reshape(-1, 3),
        frame[:, :margin].reshape(-1, 3),
        frame[:, -margin:].reshape(-1, 3),
    ))
    background = np.median(border, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    raw = np.uint8(distance > 36.0) * 255
    raw[-90:, :] = 0  # reject the generated ground shadow and corner watermark
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    if count <= 1:
        raise RuntimeError("no character component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.uint8(labels == largest) * 255


def body_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((25, 25), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        opened = mask
        count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def normalized_masks(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = body_bbox(mask)
    body_w = x1 - x0 + 1
    body_h = y1 - y0 + 1
    pad_x = round(body_w * 0.28)
    crop = mask[
        max(0, y0 - round(body_h * 0.04)):min(mask.shape[0], y1 + round(body_h * 0.10) + 1),
        max(0, x0 - pad_x):min(mask.shape[1], x1 + pad_x + 1),
    ]
    normalized = cv2.resize(crop, (192, 256), interpolation=cv2.INTER_NEAREST) > 0
    legs = normalized.copy()
    legs[:142, :] = False
    legs[:, :30] = False
    legs[:, 162:] = False
    return normalized, legs


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    return float(np.count_nonzero(left & right) / union) if union else 0.0


def save_dense_contact(frames: list[np.ndarray], start: int, end: int, output: Path) -> None:
    """Save every frame in [start, end] so endpoint similarity is not mistaken for a good gait."""
    indices = list(range(start, end + 1))
    cols = 6
    tile_w, tile_h, label_h = 320, 180, 22
    rows = (len(indices) + cols - 1) // cols
    contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for cell, index in enumerate(indices):
        x = (cell % cols) * tile_w
        y = (cell // cols) * (tile_h + label_h)
        tile = Image.fromarray(frames[index], "RGB").resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        contact.paste(tile, (x, y))
        draw.text((x + 6, y + tile_h + 3), f"f{index}", fill="white")
    contact.save(output, quality=94)


def main() -> None:
    frames, fps = decode()
    masks = [character_mask(frame) for frame in frames]
    normalized = [normalized_masks(mask) for mask in masks]
    candidates: list[dict[str, float | int]] = []
    for start in range(8, min(96, len(frames) - 14)):
        for end in range(start + 14, min(len(frames) - 5, start + 41)):
            full_iou = iou(normalized[start][0], normalized[end][0])
            leg_iou = iou(normalized[start][1], normalized[end][1])
            score = leg_iou * 0.78 + full_iou * 0.22
            candidates.append({
                "start": start,
                "end": end,
                "periodFrames": end - start,
                "periodSeconds": (end - start) / fps,
                "fullIou": full_iou,
                "legIou": leg_iou,
                "score": score,
            })
    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    selected: list[dict[str, float | int]] = []
    for candidate in candidates:
        if any(
            abs(int(candidate["start"]) - int(old["start"])) <= 2
            and abs(int(candidate["end"]) - int(old["end"])) <= 2
            for old in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) == 20:
            break

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    contact = Image.new("RGB", (1024, len(selected) * 166), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, item in enumerate(selected):
        start = int(item["start"])
        end = int(item["end"])
        for col, index in enumerate((start, end)):
            tile = Image.fromarray(frames[index], "RGB").resize((320, 180), Image.Resampling.LANCZOS)
            contact.paste(tile.crop((0, 7, 320, 173)).resize((320, 160)), (col * 320, row * 166))
            leg = Image.fromarray(np.uint8(normalized[index][1]) * 255, "L").resize((192, 160))
            contact.paste(Image.merge("RGB", (leg, leg, leg)), (640 + col * 192, row * 166))
        draw.text(
            (4, row * 166 + 150),
            f"f{start}->f{end} P={item['periodFrames']} legs={item['legIou']:.4f} full={item['fullIou']:.4f}",
            fill="white",
        )
    contact.save(OUT_DIR / "same-leg-candidates.jpg", quality=94)
    save_dense_contact(frames, 40, 61, OUT_DIR / "dense-f40-f61.jpg")
    save_dense_contact(frames, 84, 107, OUT_DIR / "dense-f84-f107.jpg")

    report = {
        "source": str(VIDEO.relative_to(ROOT)),
        "fps": fps,
        "sourceFrameCount": len(frames),
        "searchWindow": {"startMin": 8, "endMaxExclusive": len(frames) - 5, "periodFrames": [14, 40]},
        "candidates": selected,
        "selectionStatus": "selected_for_formalization",
        "selectedCycle": {
            "startInclusive": 40,
            "endExclusive": 61,
            "sourceFrames": 21,
            "sourceDurationSeconds": 21 / fps,
            "rifeMode": "loop",
            "rifeFrames": 42,
            "runtimeFps": 48,
            "reason": "middle-source complete gait with stable upper body and no late-video slowdown; f61 is seam reference only",
            "denseContact": "previews/moving-loop-analysis-v02/dense-f40-f61.jpg",
        },
    }
    (OUT_DIR / "same-leg-candidates.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
