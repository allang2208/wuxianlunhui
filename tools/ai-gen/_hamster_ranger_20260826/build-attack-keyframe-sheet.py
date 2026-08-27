#!/usr/bin/env python3
"""Build a deterministic hamster-ranger attack keyframe sheet.

The loaded aim and empty-channel release stills are aligned to the current
friendly-hamster 512px cell contract. RIFE performs the temporal interpolation
after this script; no video-generation frames are accepted for this action.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
FRAME_WIDTH = 512
FRAME_HEIGHT = 512
FEET_Y = 351
TARGET_BODY_HEIGHT = 129
MARGIN = 16


def alpha_bbox(rgba: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not xs.size:
        raise RuntimeError("transparent keyframe")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("body morphology removed every component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_anchor_x(rgba: np.ndarray, bbox: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = bbox
    top = y0 + round((y1 - y0 + 1) * 0.20)
    bottom = y0 + round((y1 - y0 + 1) * 0.72)
    ys, xs = np.where(rgba[top:bottom + 1, x0:x1 + 1, 3] > 32)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def place(rgba: np.ndarray, scale: float) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    body = body_bbox(rgba)
    anchor_x = body_anchor_x(rgba, body)
    body_bottom = body[3]
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize(
            (width, height), Image.Resampling.LANCZOS
        )
    ).copy()
    resized[resized[..., 3] == 0, :3] = 0
    offset_x = round(FRAME_WIDTH / 2 - (anchor_x - x0) * scale)
    offset_y = round(FEET_Y - (body_bottom - y0) * scale)
    if (
        offset_x < MARGIN
        or offset_y < MARGIN
        or offset_x + width > FRAME_WIDTH - MARGIN
        or offset_y + height > FRAME_HEIGHT - MARGIN
    ):
        raise RuntimeError(
            f"placement clips margin: {width}x{height} at {offset_x},{offset_y}"
        )
    cell = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def merge_rgb_alpha(source: Path, mask: Path) -> np.ndarray:
    rgb = np.asarray(Image.open(source).convert("RGB")).copy()
    alpha = np.asarray(Image.open(mask).convert("L")).copy()
    if rgb.shape[:2] != alpha.shape:
        raise RuntimeError(f"RGB/mask size mismatch: {source} / {mask}")
    rgba = np.dstack([rgb, alpha])
    rgba[rgba[..., 3] == 0, :3] = 0
    return rgba


def main() -> None:
    references = ROOT / "references"
    aim = merge_rgb_alpha(
        references / "hamster-ranger-attack-aim-keyframe-v01.png",
        references / "hamster-ranger-attack-aim-keyframe-v01-cutout.png",
    )
    release = merge_rgb_alpha(
        references / "hamster-ranger-attack-release-keyframe-v01.png",
        references / "hamster-ranger-attack-release-keyframe-v01-cutout.png",
    )
    aim_body = body_bbox(aim)
    scale = TARGET_BODY_HEIGHT / (aim_body[3] - aim_body[1] + 1)
    aim_cell = place(aim, scale)
    release_cell = place(release, scale)
    cells = [aim_cell, release_cell, aim_cell.copy()]

    sheet = np.zeros((FRAME_HEIGHT, FRAME_WIDTH * len(cells), 4), np.uint8)
    for index, cell in enumerate(cells):
        sheet[:, index * FRAME_WIDTH:(index + 1) * FRAME_WIDTH] = cell
    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(
        source_dir / "attacking-keyframes.png", optimize=True, compress_level=9
    )

    contact = Image.new("RGB", (FRAME_WIDTH * 3, FRAME_HEIGHT + 28), "#20242a")
    draw = ImageDraw.Draw(contact)
    labels = ("loaded aim", "empty release", "return aim")
    for index, (cell, label) in enumerate(zip(cells, labels)):
        contact.paste(checker(cell), (index * FRAME_WIDTH, 0))
        draw.text((index * FRAME_WIDTH + 8, FRAME_HEIGHT + 6), label, fill="white")
    contact.save(preview_dir / "attacking-keyframes-contact.png")

    report = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "source": "two approved still keyframes plus BiRefNet alpha masks; no generated video frames",
        "sequence": ["loaded aim", "empty release", "loaded aim"],
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "fixedScale": scale,
        "sourceFrameCount": len(cells),
        "sourceCols": len(cells),
        "rifeMode": "one-shot",
        "runtimeBoltSpawnKey": "release keyframe after interpolation",
    }
    (ROOT / "attack-keyframe-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
