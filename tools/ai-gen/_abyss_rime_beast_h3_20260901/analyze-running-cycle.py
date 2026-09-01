#!/usr/bin/env python3
"""Rank same-foot-phase cycle candidates in the approved Abyss Rime Beast run."""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "abyss-rime-beast-running-h3-v01.mp4"
OUT = ROOT / "reports" / "running-cycle-analysis"


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def mask(frame: np.ndarray) -> np.ndarray:
    border = np.concatenate((frame[:12].reshape(-1, 3), frame[-12:].reshape(-1, 3)))
    background = np.median(border, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    raw = np.uint8(distance > 28.0) * 255
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    if count <= 1:
        raise RuntimeError("no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.uint8(labels == largest) * 255


def normalized(source: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ys, xs = np.where(source > 0)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    pad_x = round((x1 - x0 + 1) * 0.08)
    crop = source[y0:y1 + 1, max(0, x0 - pad_x):min(source.shape[1], x1 + pad_x + 1)]
    body = cv2.resize(crop, (256, 192), interpolation=cv2.INTER_NEAREST) > 0
    legs = body.copy()
    legs[:104, :] = False
    legs[:, :18] = False
    legs[:, 238:] = False
    return body, legs


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    return float(np.count_nonzero(left & right) / union) if union else 0.0


def main() -> None:
    frames, fps = decode()
    masks = [normalized(mask(frame)) for frame in frames]
    ranked: list[dict[str, float | int]] = []
    for start in range(8, min(96, len(frames) - 18)):
        for end in range(start + 16, min(len(frames) - 8, start + 45)):
            body_iou = iou(masks[start][0], masks[end][0])
            leg_iou = iou(masks[start][1], masks[end][1])
            ranked.append({
                "start": start,
                "end": end,
                "periodFrames": end - start,
                "periodMs": round((end - start) * 1000 / fps, 3),
                "legIou": leg_iou,
                "bodyIou": body_iou,
                "score": leg_iou * 0.82 + body_iou * 0.18,
            })
    ranked.sort(key=lambda item: float(item["score"]), reverse=True)
    selected: list[dict[str, float | int]] = []
    for item in ranked:
        if any(abs(int(item["start"]) - int(old["start"])) <= 2
               and abs(int(item["end"]) - int(old["end"])) <= 2 for old in selected):
            continue
        selected.append(item)
        if len(selected) == 20:
            break

    OUT.mkdir(parents=True, exist_ok=True)
    contact = Image.new("RGB", (1024, len(selected) * 180), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, item in enumerate(selected):
        start, end = int(item["start"]), int(item["end"])
        for col, index in enumerate((start, end)):
            tile = Image.fromarray(frames[index], "RGB").resize((512, 288), Image.Resampling.LANCZOS)
            contact.paste(tile, (col * 512, row * 180))
        draw.rectangle((0, row * 180 + 156, 1024, row * 180 + 180), fill="#20242a")
        draw.text((6, row * 180 + 160),
                  f"f{start}->f{end} P={end-start} legs={item['legIou']:.4f} body={item['bodyIou']:.4f}",
                  fill="white")
    contact.save(OUT / "same-foot-candidates.jpg", quality=94)

    for rank, item in enumerate(selected[:5], start=1):
        start, end = int(item["start"]), int(item["end"])
        preview = [Image.fromarray(frame, "RGB").resize((512, 288), Image.Resampling.LANCZOS)
                   for frame in frames[start:end]] * 3
        preview[0].save(OUT / f"candidate-{rank:02d}-f{start}-f{end-1}.gif",
                        save_all=True, append_images=preview[1:], duration=round(1000 / fps),
                        loop=0, disposal=2, optimize=False)

    report = {
        "sourceVideo": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "fps": fps,
        "sourceFrameCount": len(frames),
        "searchWindow": {"start": [8, 95], "periodFrames": [16, 44]},
        "candidates": selected,
        "selectionStatus": "requires-contact-and-loop-preview-review",
    }
    (OUT / "candidates.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
