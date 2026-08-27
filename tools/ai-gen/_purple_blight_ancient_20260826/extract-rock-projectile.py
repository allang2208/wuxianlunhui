#!/usr/bin/env python3
"""Inspect the accepted throw sheet and extract its thrown rock as a real RGBA asset."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SHEET = ROOT / "generated" / "final" / "throw.png"
OUT = ROOT / "projectile"
FRAME_W = 768
FRAME_H = 512
COLS = 8
FRAME_COUNT = 31
INSPECT_FRAMES = range(10, 23)
SOURCE_FRAME = 14
ROCK_POLYGON = np.array([
    [222, 116], [247, 120], [266, 137], [278, 161], [275, 187],
    [260, 210], [235, 226], [209, 224], [185, 208], [165, 189],
    [161, 164], [171, 140], [194, 122],
], dtype=np.int32)


def frame_at(sheet: Image.Image, index: int) -> Image.Image:
    x = (index % COLS) * FRAME_W
    y = (index // COLS) * FRAME_H
    return sheet.crop((x, y, x + FRAME_W, y + FRAME_H))


def component_report(frame: Image.Image) -> list[dict]:
    alpha = np.asarray(frame.getchannel("A"), dtype=np.uint8)
    count, _labels, stats, centers = cv2.connectedComponentsWithStats((alpha > 16).astype(np.uint8), 8)
    rows = []
    for label in range(1, count):
        x, y, w, h, area = [int(value) for value in stats[label]]
        if area < 20:
            continue
        rows.append({
            "area": area,
            "bbox": [x, y, x + w, y + h],
            "center": [round(float(centers[label][0]), 1), round(float(centers[label][1]), 1)],
        })
    return sorted(rows, key=lambda row: row["area"], reverse=True)


def extract_rock(frame: Image.Image) -> tuple[Image.Image, dict]:
    rgba = np.asarray(frame, dtype=np.uint8)
    rgb = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2BGR)
    alpha = rgba[..., 3]

    # GrabCut is constrained to the hand-held rock silhouette. The eroded polygon
    # supplies undeniable rock pixels; everything outside the approved polygon is
    # undeniable background, preventing the nearby wooden hand from leaking in.
    outer = np.zeros((FRAME_H, FRAME_W), dtype=np.uint8)
    cv2.fillPoly(outer, [ROCK_POLYGON], 255)
    inner = cv2.erode(outer, np.ones((15, 15), np.uint8), iterations=1)
    mask = np.full((FRAME_H, FRAME_W), cv2.GC_BGD, dtype=np.uint8)
    mask[outer > 0] = cv2.GC_PR_FGD
    mask[inner > 0] = cv2.GC_FGD
    mask[alpha == 0] = cv2.GC_BGD
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(rgb, mask, None, bg_model, fg_model, 7, cv2.GC_INIT_WITH_MASK)
    binary = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Preserve the original anti-aliased alpha at the outer contour, with only a
    # one-pixel feather from the deterministic mask. Transparent RGB is cleared.
    feather = cv2.GaussianBlur(binary, (0, 0), 0.65)
    rock_alpha = np.minimum(alpha, feather)
    ys, xs = np.where(rock_alpha > 8)
    if not len(xs):
        raise RuntimeError("rock extraction produced an empty alpha mask")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    pad = 8
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(FRAME_W, x1 + pad), min(FRAME_H, y1 + pad)
    cut = rgba[y0:y1, x0:x1].copy()
    cut[..., 3] = rock_alpha[y0:y1, x0:x1]
    cut[cut[..., 3] == 0, :3] = 0

    source = Image.fromarray(cut, "RGBA")
    bbox = source.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("rock crop is empty")
    source = source.crop(bbox)
    scale = min(208 / source.width, 208 / source.height)
    scaled = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    px = (256 - scaled.width) // 2
    py = (256 - scaled.height) // 2
    canvas.alpha_composite(scaled, (px, py))
    out_alpha = np.asarray(canvas.getchannel("A"), dtype=np.uint8)
    out_rgba = np.asarray(canvas, dtype=np.uint8).copy()
    out_rgba[out_alpha == 0, :3] = 0
    canvas = Image.fromarray(out_rgba, "RGBA")
    report = {
        "sourceFrame": SOURCE_FRAME,
        "sourcePolygon": ROCK_POLYGON.tolist(),
        "sourceCrop": [x0, y0, x1, y1],
        "sourceContentSize": list(source.size),
        "runtimeCanvas": [256, 256],
        "runtimeAlphaBBox": list(canvas.getchannel("A").getbbox() or ()),
        "alphaExtrema": list(canvas.getchannel("A").getextrema()),
        "visiblePixels": int((out_alpha > 8).sum()),
        "transparentRgbPixels": int(((out_alpha == 0) & (out_rgba[..., :3].max(axis=2) > 0)).sum()),
    }
    return canvas, report


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    frames_dir = OUT / "source-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGBA")
    report = {}
    cells = []
    for index in INSPECT_FRAMES:
        frame = frame_at(sheet, index)
        frame.save(frames_dir / f"throw-frame-{index:02d}.png")
        report[str(index)] = component_report(frame)
        preview = frame.copy()
        draw = ImageDraw.Draw(preview)
        draw.rectangle((0, 0, 118, 28), fill=(18, 22, 28, 235))
        draw.text((8, 7), f"frame {index}", fill=(255, 255, 255, 255))
        cells.append(preview)
    contact = Image.new("RGBA", (FRAME_W * 4, FRAME_H * 4), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        contact.alpha_composite(cell, ((i % 4) * FRAME_W, (i // 4) * FRAME_H))
    contact.save(OUT / "throw-rock-source-contact.png")
    (OUT / "component-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    rock, rock_report = extract_rock(frame_at(sheet, SOURCE_FRAME))
    rock.save(OUT / "purple-ancient-rock.png")
    (OUT / "purple-ancient-rock-report.json").write_text(
        json.dumps(rock_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(rock_report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
