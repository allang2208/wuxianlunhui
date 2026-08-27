#!/usr/bin/env python3
"""Diagnose hamster-sniper running flicker without changing source assets."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE_SHEET = ROOT / "source-sheets-pre-interpolation" / "running.png"
FINAL_SHEET = ROOT / "sheets" / "interpolated" / "running.png"
PREVIEW_GIF = ROOT / "previews" / "interpolated" / "running-interpolated.gif"
VIDEO = ROOT / "videos" / "running-doubao-v02.mp4"
OUT = ROOT / "previews" / "diagnostics"
FRAME_SIZE = 512
COLS = 8
SOURCE_COUNT = 13
FINAL_COUNT = 26


def split_sheet(path: Path, count: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    cells = []
    for index in range(count):
        row, col = divmod(index, COLS)
        cells.append(
            sheet[
                row * FRAME_SIZE:(row + 1) * FRAME_SIZE,
                col * FRAME_SIZE:(col + 1) * FRAME_SIZE,
            ].copy()
        )
    return cells


def metrics(cell: np.ndarray) -> dict[str, object]:
    mask = cell[..., 3] > 32
    ys, xs = np.where(mask)
    rgb = cell[..., :3].astype(np.float32)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    return {
        "alphaArea": int(mask.sum()),
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
        "center": [float(xs.mean()), float(ys.mean())],
        "foregroundLumaMean": float(luma[mask].mean()),
        "foregroundLumaP10": float(np.percentile(luma[mask], 10)),
    }


def alpha_iou(left: np.ndarray, right: np.ndarray, bottom_fraction: float = 1.0) -> float:
    lm = left[..., 3] > 32
    rm = right[..., 3] > 32
    if bottom_fraction < 1.0:
        top = round(FRAME_SIZE * (1.0 - bottom_fraction))
        lm = lm[top:]
        rm = rm[top:]
    union = np.logical_or(lm, rm).sum()
    return float(np.logical_and(lm, rm).sum() / union) if union else 1.0


def visible_delta(left: np.ndarray, right: np.ndarray) -> float:
    mask = np.logical_or(left[..., 3] > 32, right[..., 3] > 32)
    delta = np.abs(left[..., :3].astype(np.float32) - right[..., :3].astype(np.float32)).mean(axis=2)
    return float(delta[mask].mean()) if mask.any() else 0.0


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def save_final_contact(cells: list[np.ndarray], path: Path) -> None:
    indices = list(range(FINAL_COUNT))
    thumb = 384
    label = 30
    cols = 4
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (cols * thumb, rows * (thumb + label)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        image = checker(cells[index]).resize((thumb, thumb), Image.Resampling.NEAREST)
        x = position % cols * thumb
        y = position // cols * (thumb + label)
        contact.paste(image, (x, y))
        kind = "key" if index % 2 == 0 else "RIFE"
        draw.text((x + 6, y + thumb + 6), f"f{index} {kind}", fill="white")
    contact.save(path)


def save_raw_contact(path: Path) -> dict[str, object]:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    indices = list(range(40, 65))
    thumb_w, thumb_h, label_h, cols = 384, 216, 28, 5
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    deltas = []
    for position, index in enumerate(indices):
        frame = Image.fromarray(frames[index], "RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = position % cols * thumb_w
        y = position // cols * (thumb_h + label_h)
        contact.paste(frame, (x, y))
        draw.text((x + 6, y + thumb_h + 5), f"raw f{index} / {index / fps:.3f}s", fill="white")
        if position:
            left = cv2.resize(frames[index - 1], (320, 180), interpolation=cv2.INTER_AREA)
            right = cv2.resize(frames[index], (320, 180), interpolation=cv2.INTER_AREA)
            subject = np.minimum(left, right).mean(axis=2) < 245
            delta = np.abs(left.astype(np.float32) - right.astype(np.float32)).mean(axis=2)
            deltas.append(float(delta[subject].mean()) if subject.any() else 0.0)
    contact.save(path, quality=94)
    return {"indices": indices, "adjacentSubjectDelta": deltas, "fps": fps}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = split_sheet(SOURCE_SHEET, SOURCE_COUNT)
    final = split_sheet(FINAL_SHEET, FINAL_COUNT)
    source_metrics = [metrics(cell) for cell in source]
    final_metrics = [metrics(cell) for cell in final]
    gif = Image.open(PREVIEW_GIF)
    gif_frames = []
    for index in range(gif.n_frames):
        gif.seek(index)
        gif_frames.append(np.asarray(gif.convert("RGB")).copy())
    gif_comparison = []
    dark_components = []
    for index, cell in enumerate(final):
        expected = np.asarray(
            checker(cell).resize((384, 384), Image.Resampling.LANCZOS)
        ).astype(np.int16)
        actual = gif_frames[index].astype(np.int16)
        absolute = np.abs(expected - actual)
        gif_comparison.append({
            "index": index,
            "meanAbsoluteRgbDelta": float(absolute.mean()),
            "pixelsWithChannelDeltaOver30": int(np.count_nonzero(np.max(absolute, axis=2) > 30)),
        })

        alpha = cell[..., 3] > 96
        dark = (np.max(cell[..., :3], axis=2) < 64) & alpha
        count, _, stats, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), 8)
        largest = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
        dark_components.append({
            "index": index,
            "darkPixels": int(dark.sum()),
            "largestDarkComponent": largest,
        })

    odd_frame_diagnostics = []
    for index in range(1, FINAL_COUNT, 2):
        left = final[index - 1]
        right = final[(index + 1) % FINAL_COUNT]
        current = final[index]
        current_luma = final_metrics[index]["foregroundLumaMean"]
        neighbor_luma = (
            final_metrics[index - 1]["foregroundLumaMean"]
            + final_metrics[(index + 1) % FINAL_COUNT]["foregroundLumaMean"]
        ) / 2.0
        odd_frame_diagnostics.append(
            {
                "index": index,
                "lumaRatioToNeighborMean": float(current_luma / neighbor_luma),
                "alphaAreaRatioToNeighborMean": float(
                    final_metrics[index]["alphaArea"]
                    / ((final_metrics[index - 1]["alphaArea"] + final_metrics[(index + 1) % FINAL_COUNT]["alphaArea"]) / 2.0)
                ),
                "deltaFromLeft": visible_delta(left, current),
                "deltaToRight": visible_delta(current, right),
            }
        )

    source_pairs = []
    for index in range(SOURCE_COUNT):
        next_index = (index + 1) % SOURCE_COUNT
        source_pairs.append(
            {
                "from": index,
                "to": next_index,
                "alphaIou": alpha_iou(source[index], source[next_index]),
                "bottom35AlphaIou": alpha_iou(source[index], source[next_index], 0.35),
                "visibleDelta": visible_delta(source[index], source[next_index]),
            }
        )

    raw = save_raw_contact(OUT / "running-raw-f40-64-step1-contact.jpg")
    save_final_contact(final, OUT / "running-final-26-frame-contact.png")
    report = {
        "sourceIndices": list(range(40, 65, 2)),
        "sourceMetrics": source_metrics,
        "sourcePairDiagnostics": source_pairs,
        "finalMetrics": final_metrics,
        "oddFrameDiagnostics": odd_frame_diagnostics,
        "gifEncodingComparison": gif_comparison,
        "darkComponentDiagnostics": dark_components,
        "rawWindow": raw,
    }
    (OUT / "running-flicker-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({
        "oddFrameDiagnostics": odd_frame_diagnostics,
        "sourcePairDiagnostics": source_pairs,
        "gifEncodingComparison": gif_comparison,
        "darkComponentDiagnostics": dark_components,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
