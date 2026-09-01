#!/usr/bin/env python3
"""Find same-leg loop candidates in the accepted H3 champion run source."""

from __future__ import annotations

import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "running-h3-v03.mp4"
OUT_DIR = ROOT / "previews" / "running-loop-analysis-v03"


def decode() -> tuple[list[np.ndarray], float]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def character_mask(frame: np.ndarray) -> np.ndarray:
    # H3 uses an almost uniform blue plate. Estimate it per frame from the
    # untouched outer border so codec drift cannot change the threshold.
    border = np.concatenate((frame[:16].reshape(-1, 3), frame[-16:].reshape(-1, 3)))
    background = np.median(border, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - background, axis=2)
    raw = np.uint8(distance > 42.0) * 255
    raw = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    if count <= 1:
        raise RuntimeError("no character component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.uint8(labels == largest) * 255


def body_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    # Remove the long, thin sword before deriving a body-normalized crop.
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((19, 19), np.uint8))
    ys, xs = np.where(opened > 0)
    if not len(xs):
        ys, xs = np.where(mask > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def normalized_masks(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = body_bbox(mask)
    body_w = x1 - x0 + 1
    body_h = y1 - y0 + 1
    pad_x = round(body_w * 0.22)
    crop = mask[
        max(0, y0 - round(body_h * 0.04)):min(mask.shape[0], y1 + round(body_h * 0.08) + 1),
        max(0, x0 - pad_x):min(mask.shape[1], x1 + pad_x + 1),
    ]
    normalized = cv2.resize(crop, (192, 256), interpolation=cv2.INTER_NEAREST) > 0
    legs = normalized.copy()
    legs[:145, :] = False
    legs[:, :24] = False
    legs[:, 168:] = False
    return normalized, legs


def iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    return float(np.count_nonzero(left & right) / union) if union else 0.0


def main() -> None:
    frames, fps = decode()
    masks = [character_mask(frame) for frame in frames]
    normalized = [normalized_masks(mask) for mask in masks]
    candidates: list[dict[str, float | int]] = []
    # Avoid the H3 first/last-frame lock zones; search complete strides in the
    # stable middle of the source. A useful armored run period is 0.75-2.0 s.
    for start in range(8, min(91, len(frames) - 18)):
        for end in range(start + 18, min(len(frames) - 7, start + 49)):
            full_iou = iou(normalized[start][0], normalized[end][0])
            leg_iou = iou(normalized[start][1], normalized[end][1])
            score = leg_iou * 0.74 + full_iou * 0.26
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
        if len(selected) == 24:
            break

    periods = []
    for period in range(18, 49):
        values = [float(item["score"]) for item in candidates if item["periodFrames"] == period]
        leg_values = [float(item["legIou"]) for item in candidates if item["periodFrames"] == period]
        periods.append({
            "periodFrames": period,
            "periodSeconds": period / fps,
            "medianScore": float(np.median(values)),
            "upperQuartileScore": float(np.quantile(values, 0.75)),
            "medianLegIou": float(np.median(leg_values)),
        })
    periods.sort(key=lambda item: (item["medianScore"], item["upperQuartileScore"]), reverse=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    contact = Image.new("RGB", (1024, len(selected) * 166), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, item in enumerate(selected):
        start = int(item["start"])
        end = int(item["end"])
        for col, index in enumerate((start, end)):
            tile = Image.fromarray(frames[index], "RGB").resize((320, 180), Image.Resampling.LANCZOS)
            contact.paste(tile.crop((0, 7, 320, 173)).resize((320, 160)), (col * 320, row * 166))
        for col, index in enumerate((start, end)):
            leg = Image.fromarray(np.uint8(normalized[index][1]) * 255, "L").resize((192, 160))
            contact.paste(Image.merge("RGB", (leg, leg, leg)), (640 + col * 192, row * 166))
        draw.text(
            (4, row * 166 + 150),
            f"f{start}->f{end} P={item['periodFrames']} legs={item['legIou']:.4f} full={item['fullIou']:.4f}",
            fill="white",
        )
    contact.save(OUT_DIR / "same-leg-candidates.jpg", quality=94)

    dense = Image.new("RGB", (1280, 6 * 202), "#20242a")
    dense_draw = ImageDraw.Draw(dense)
    dense_indices = list(range(0, len(frames), 4))
    for position, index in enumerate(dense_indices):
        tile = Image.fromarray(frames[index], "RGB").resize((256, 144), Image.Resampling.LANCZOS)
        x = (position % 5) * 256
        y = (position // 5) * 202
        dense.paste(tile, (x, y))
        dense_draw.text((x + 4, y + 146), f"source f{index}", fill="white")
    dense.save(OUT_DIR / "dense-contact-f0-f120-step4.jpg", quality=94)

    for start, end in ((41, 61), (54, 75), (44, 64)):
        loop_frames = [
            Image.fromarray(frame, "RGB").resize((512, 288), Image.Resampling.LANCZOS)
            for frame in frames[start:end]
        ] * 3
        loop_frames[0].save(
            OUT_DIR / f"source-loop-f{start}-f{end - 1}.gif",
            save_all=True,
            append_images=loop_frames[1:],
            duration=round(1000 / fps),
            loop=0,
            disposal=2,
            optimize=False,
        )

    selected_cycle = next(
        item for item in candidates if item["start"] == 41 and item["end"] == 61
    )
    report = {
        "source": str(VIDEO.relative_to(ROOT)),
        "fps": fps,
        "sourceFrameCount": len(frames),
        "searchWindow": {"startMin": 8, "endMaxExclusive": len(frames) - 7, "periodFrames": [18, 48]},
        "selectedCycle": {
            **selected_cycle,
            "includedRange": "[41,61)",
            "includedFrames": [41, 60],
            "duplicateEndpoint": 61,
            "selectionReason": "complete native two-step cycle in the stable middle run with matching planted-leg phase",
        },
        "bestPeriods": periods[:12],
        "candidates": selected,
    }
    (OUT_DIR / "same-leg-candidates.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
