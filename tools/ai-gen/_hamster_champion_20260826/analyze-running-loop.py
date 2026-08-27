#!/usr/bin/env python3
"""Find same-leg phase pairs in the hamster champion's original running video."""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "running-doubao-v02.mp4"
OUT_DIR = ROOT / "previews" / "running-loop-analysis"


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def character_mask(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    saturation = cv2.cvtColor(frame, cv2.COLOR_RGB2HSV)[..., 1]
    raw = np.uint8((gray < 225) | ((gray < 242) & (saturation > 24))) * 255
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    candidates = []
    height, width = gray.shape
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if area >= 500 and x < width * 0.75 and y < height * 0.82:
            candidates.append((area, label))
    if not candidates:
        raise RuntimeError("no character component")
    label = max(candidates)[1]
    mask = np.uint8(labels == label) * 255
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def body_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((23, 23), np.uint8))
    ys, xs = np.where(opened > 0)
    if not len(xs):
        ys, xs = np.where(mask > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def normalized_masks(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = body_bbox(mask)
    body_w = x1 - x0 + 1
    body_h = y1 - y0 + 1
    pad_x = round(body_w * 0.3)
    crop_x0 = max(0, x0 - pad_x)
    crop_x1 = min(mask.shape[1] - 1, x1 + pad_x)
    crop_y0 = max(0, y0 - round(body_h * 0.08))
    crop_y1 = min(mask.shape[0] - 1, y1 + round(body_h * 0.12))
    crop = mask[crop_y0:crop_y1 + 1, crop_x0:crop_x1 + 1]
    normalized = cv2.resize(crop, (192, 256), interpolation=cv2.INTER_NEAREST) > 0
    legs = normalized.copy()
    legs[:138, :] = False
    legs[:, :28] = False
    legs[:, 164:] = False
    return normalized, legs


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    return float(np.count_nonzero(left & right) / union) if union else 0.0


def main() -> None:
    frames, fps = decode()
    masks = [character_mask(frame) for frame in frames]
    normalized = [normalized_masks(mask) for mask in masks]
    candidates = []
    # Skip the standing-to-running transition and require at least 1.25 seconds.
    for start in range(16, 77):
        for end in range(start + 30, min(len(frames), start + 73)):
            full_iou = iou(normalized[start][0], normalized[end][0])
            leg_iou = iou(normalized[start][1], normalized[end][1])
            score = leg_iou * 0.72 + full_iou * 0.28
            candidates.append({
                "start": start,
                "end": end,
                "periodFrames": end - start,
                "periodSeconds": (end - start) / fps,
                "fullIou": full_iou,
                "legIou": leg_iou,
                "score": score,
            })
    candidates.sort(key=lambda item: item["score"], reverse=True)
    periods = []
    for period in range(30, 73):
        values = [item["score"] for item in candidates if item["periodFrames"] == period]
        leg_values = [item["legIou"] for item in candidates if item["periodFrames"] == period]
        periods.append({
            "periodFrames": period,
            "periodSeconds": period / fps,
            "medianScore": float(np.median(values)),
            "upperQuartileScore": float(np.quantile(values, 0.75)),
            "medianLegIou": float(np.median(leg_values)),
        })
    periods.sort(key=lambda item: (item["medianScore"], item["upperQuartileScore"]), reverse=True)
    steady_phase_evidence = []
    for start in range(36, 77, 4):
        end = start + 40
        if end >= len(frames):
            break
        steady_phase_evidence.append({
            "start": start,
            "end": end,
            "fullIou": iou(normalized[start][0], normalized[end][0]),
            "legIou": iou(normalized[start][1], normalized[end][1]),
        })
    # Keep distinct periods/start neighborhoods so the contact is informative.
    selected = []
    for candidate in candidates:
        if any(abs(candidate["start"] - old["start"]) <= 2 and abs(candidate["end"] - old["end"]) <= 2 for old in selected):
            continue
        selected.append(candidate)
        if len(selected) == 16:
            break

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_loop = [Image.fromarray(frame, "RGB").resize((512, 288), Image.Resampling.LANCZOS) for frame in frames[44:84]]
    raw_loop[0].save(
        OUT_DIR / "original-f44-f83-loop.gif",
        save_all=True,
        append_images=raw_loop[1:],
        duration=round(1000 / fps),
        loop=0,
        disposal=2,
    )
    comparison = Image.new("RGB", (1280, 204), "#20242a")
    comparison_draw = ImageDraw.Draw(comparison)
    for position, index in enumerate((20, 42, 44, 84)):
        tile = Image.fromarray(frames[index], "RGB").resize((320, 180), Image.Resampling.LANCZOS)
        comparison.paste(tile, (position * 320, 0))
        comparison_draw.text((position * 320 + 5, 184), f"source f{index}", fill="white")
    comparison.save(OUT_DIR / "rejected-vs-natural-endpoints.jpg", quality=94)
    contact = Image.new("RGB", (1280, len(selected) * 190), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, item in enumerate(selected):
        for col, index in enumerate((item["start"], item["end"])):
            tile = Image.fromarray(frames[index], "RGB").resize((320, 180), Image.Resampling.LANCZOS)
            contact.paste(tile, (col * 320, row * 190))
        left_mask = Image.fromarray(np.uint8(normalized[item["start"]][1]) * 255, "L").resize((256, 180))
        right_mask = Image.fromarray(np.uint8(normalized[item["end"]][1]) * 255, "L").resize((256, 180))
        contact.paste(Image.merge("RGB", (left_mask, left_mask, left_mask)), (640, row * 190))
        contact.paste(Image.merge("RGB", (right_mask, right_mask, right_mask)), (896, row * 190))
        draw.text(
            (5, row * 190 + 180),
            f"f{item['start']} -> f{item['end']}  P={item['periodFrames']}  legs={item['legIou']:.4f} full={item['fullIou']:.4f}",
            fill="white",
        )
    contact.save(OUT_DIR / "same-leg-candidates.jpg", quality=94)
    report = {
        "source": str(VIDEO.relative_to(ROOT)),
        "fps": fps,
        "bestPeriods": periods[:12],
        "steadyPhaseEvidenceP40": steady_phase_evidence,
        "candidates": selected,
    }
    (OUT_DIR / "same-leg-candidates.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
