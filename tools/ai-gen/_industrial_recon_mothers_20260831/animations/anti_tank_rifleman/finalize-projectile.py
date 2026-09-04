#!/usr/bin/env python3
"""Clean and normalize the approved anti-tank grenade projectile source."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "projectile" / "anti-tank-grenade-projectile-v01.png"
OUT = ROOT / "postprocess" / "projectile"
CANVAS = (512, 256)
MAX_OBJECT = (460, 210)


def alpha_bbox(alpha: np.ndarray, threshold: int = 0) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not xs.size:
        raise RuntimeError("Projectile alpha is empty")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rgba = np.asarray(Image.open(SOURCE).convert("RGBA")).copy()
    alpha = rgba[..., 3]
    low_alpha_pixels_cleared = int(np.count_nonzero((alpha > 0) & (alpha <= 16)))
    rgba[alpha <= 16] = 0

    foreground = (rgba[..., 3] > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("Projectile has no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    detached_pixels_removed = int(np.count_nonzero((rgba[..., 3] > 0) & ~keep))
    rgba[~keep] = 0
    rgba[rgba[..., 3] == 0, :3] = 0

    source_bbox = alpha_bbox(rgba[..., 3])
    x0, y0, x1, y1 = source_bbox
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    scale = min(MAX_OBJECT[0] / crop.shape[1], MAX_OBJECT[1] / crop.shape[0])
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    ).copy()
    resized[resized[..., 3] <= 2] = 0
    resized[resized[..., 3] == 0, :3] = 0
    canvas = np.zeros((CANVAS[1], CANVAS[0], 4), np.uint8)
    offset_x = (CANVAS[0] - width) // 2
    offset_y = (CANVAS[1] - height) // 2
    canvas[offset_y:offset_y + height, offset_x:offset_x + width] = resized

    # The visible metal/wood joint is about 60% along the approved silhouette.
    # This is recorded for later runtime rotation; no gameplay integration is
    # performed in this asset pass.
    pivot_x = round(offset_x + width * 0.60)
    pivot_y = round(offset_y + height * 0.52)
    output = OUT / "anti-tank-grenade-clean-512x256.png"
    Image.fromarray(canvas, "RGBA").save(output, optimize=True, compress_level=9)

    bbox = alpha_bbox(canvas[..., 3])
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "anti_tank_rifleman",
        "assetOnly": True,
        "runtimeIntegration": False,
        "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "output": str(output.relative_to(ROOT)).replace("\\", "/"),
        "sourceAlphaBBoxAfterCleanup": list(source_bbox),
        "lowAlphaPixelsClearedAtOrBelow16": low_alpha_pixels_cleared,
        "detachedPixelsRemoved": detached_pixels_removed,
        "canvasSize": list(CANVAS),
        "objectSize": [width, height],
        "objectAlphaBBox": list(bbox),
        "rotationPivotPx": [pivot_x, pivot_y],
        "rotationPivotBasis": "visible metal-head/wood-handle joint at approximately 60% of the cleaned silhouette length",
        "orientation": "metal head points screen right; wooden handle trails left",
        "nonzeroRgbInTransparentPixels": int(np.count_nonzero(canvas[..., :3][canvas[..., 3] == 0])),
        "alphaExtrema": [int(canvas[..., 3].min()), int(canvas[..., 3].max())],
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
