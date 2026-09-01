#!/usr/bin/env python3
"""Rank same-phase loop endpoints in the movement-only Doubao v05 source."""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "running-doubao-v05-reference-only.mp4"
OUT = ROOT / "previews" / "running-loop-analysis-v05"


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def subject_mask(frame: np.ndarray) -> np.ndarray:
    border = np.concatenate((
        frame[:16].reshape(-1, 3), frame[-16:].reshape(-1, 3),
        frame[:, :16].reshape(-1, 3), frame[:, -16:].reshape(-1, 3),
    ))
    background = np.median(border, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    raw = np.uint8(distance > 36.0) * 255
    raw[-90:, :] = 0
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    if count <= 1:
        raise RuntimeError("no subject component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.uint8(labels == largest) * 255


def normalize(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((25, 25), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        opened = mask
        count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    body_w, body_h = x1 - x0 + 1, y1 - y0 + 1
    pad_x = round(body_w * 0.30)
    crop = mask[
        max(0, y0 - round(body_h * 0.04)):min(mask.shape[0], y1 + round(body_h * 0.10) + 1),
        max(0, x0 - pad_x):min(mask.shape[1], x1 + pad_x + 1),
    ]
    full = cv2.resize(crop, (192, 256), interpolation=cv2.INTER_NEAREST) > 0
    legs = full.copy()
    legs[:142, :] = False
    legs[:, :24] = False
    legs[:, 168:] = False
    return full, legs


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    return float(np.count_nonzero(left & right) / union) if union else 0.0


def save_dense(frames: list[np.ndarray], start: int, end: int, path: Path) -> None:
    indices = list(range(start, end + 1))
    cols, tile_w, tile_h, label_h = 6, 320, 180, 22
    rows = (len(indices) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(sheet)
    for cell, index in enumerate(indices):
        x, y = (cell % cols) * tile_w, (cell // cols) * (tile_h + label_h)
        tile = Image.fromarray(frames[index], "RGB").resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        sheet.paste(tile, (x, y))
        draw.text((x + 6, y + tile_h + 3), f"f{index}", fill="white")
    sheet.save(path, quality=94)


def main() -> None:
    frames, fps = decode()
    normalized = [normalize(subject_mask(frame)) for frame in frames]
    candidates: list[dict[str, float | int]] = []
    for start in range(8, min(102, len(frames) - 16)):
        for end in range(start + 16, min(len(frames) - 4, start + 41)):
            full = iou(normalized[start][0], normalized[end][0])
            legs = iou(normalized[start][1], normalized[end][1])
            candidates.append({
                "start": start, "end": end, "periodFrames": end - start,
                "periodSeconds": (end - start) / fps,
                "fullIou": full, "legIou": legs, "score": legs * 0.78 + full * 0.22,
            })
    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    selected: list[dict[str, float | int]] = []
    for candidate in candidates:
        if any(abs(int(candidate["start"]) - int(old["start"])) <= 2 and
               abs(int(candidate["end"]) - int(old["end"])) <= 2 for old in selected):
            continue
        selected.append(candidate)
        if len(selected) == 12:
            break

    OUT.mkdir(parents=True, exist_ok=True)
    comparison = Image.new("RGB", (1280, len(selected) * 202), "#20242a")
    draw = ImageDraw.Draw(comparison)
    for row, item in enumerate(selected):
        start, end = int(item["start"]), int(item["end"])
        for col, index in enumerate((start, end)):
            tile = Image.fromarray(frames[index], "RGB").resize((640, 360), Image.Resampling.LANCZOS)
            comparison.paste(tile.crop((0, 0, 640, 360)).resize((640, 180)), (col * 640, row * 202))
        draw.text((6, row * 202 + 182),
                  f"f{start}->f{end} P={item['periodFrames']} legs={item['legIou']:.4f} full={item['fullIou']:.4f}",
                  fill="white")
        if row < 6:
            save_dense(frames, start, end, OUT / f"dense-f{start}-f{end}.jpg")
    comparison.save(OUT / "same-phase-candidates.jpg", quality=94)
    report = {
        "schemaVersion": 1,
        "source": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "fps": fps,
        "sourceFrameCount": len(frames),
        "searchWindow": {"startMin": 8, "endMaxExclusive": len(frames) - 4, "periodFrames": [16, 40]},
        "candidates": selected,
        "selectionStatus": "selected_for_formalization",
        "selectedCycle": {
            "startInclusive": 15,
            "endExclusive": 51,
            "samePhaseEndpoint": 51,
            "sourceFramesAt24Fps": 36,
            "selectedSourceIndices": list(range(15, 51, 2)),
            "sourceSheetFrameRate": 12,
            "rifeMode": "loop",
            "rifeFrames": 36,
            "runtimeFrameRate": 24,
            "reason": (
                "highest-ranked stable complete two-step cycle; no firing, recoil, "
                "pumping or attack pause; f51 is the excluded same-phase endpoint"
            ),
        },
    }
    (OUT / "same-phase-candidates.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
