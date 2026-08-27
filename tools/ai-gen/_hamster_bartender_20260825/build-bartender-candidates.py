#!/usr/bin/env python3
"""Build review-only bartender sheets from the approved local worker motion cells.

The source motions and alpha geometry stay byte-for-byte aligned with the approved
boiler-worker sheets.  Only opaque garment pixels are colour-directed so this
stage cannot disturb the hand-picked frame trajectory or the shared 236/256
foot line.  Outputs intentionally remain outside runtime assets until approval.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE_ROOT = REPO / "tools" / "ai-gen" / "_hamster_boiler_worker_20260825"
SOURCE_SHEETS = REPO / "assets" / "companions" / "hamster_boiler_worker"
OUT = ROOT / "candidates"
SHEETS = OUT / "sheets"
PREVIEWS = OUT / "previews"
CELL = 256
FEET_Y = 236
COLS = 4
ACTIONS = {
    "idle": {"count": 8, "frameRate": 8},
    "empty_running": {"count": 12, "frameRate": 12},
    "food_loaded_running": {"count": 12, "frameRate": 12},
}


def alpha_bbox(cell: np.ndarray) -> tuple[int, int, int, int]:
    yy, xx = np.where(cell[..., 3] > 10)
    if len(xx) == 0:
        return 0, 0, 0, 0
    return int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())


def frame_delta(left: np.ndarray, right: np.ndarray) -> float:
    mask = (left[..., 3] > 10) | (right[..., 3] > 10)
    if not mask.any():
        return 0.0
    a = left.astype(np.float32)
    b = right.astype(np.float32)
    return float(np.abs(a - b)[mask].mean())


def validate_cells(cells: list[np.ndarray]) -> dict[str, object]:
    bboxes = [alpha_bbox(cell) for cell in cells]
    alpha_counts = [int((cell[..., 3] > 10).sum()) for cell in cells]
    touching = [
        index
        for index, (x0, y0, x1, y1) in enumerate(bboxes)
        if x0 <= 2 or y0 <= 2 or x1 >= CELL - 3 or y1 >= CELL - 3
    ]
    adjacent = [frame_delta(left, right) for left, right in zip(cells, cells[1:])]
    return {
        "alphaPixelsMin": min(alpha_counts),
        "alphaPixelsMax": max(alpha_counts),
        "emptyFrames": [index for index, count in enumerate(alpha_counts) if count < 50],
        "touchingFrames": touching,
        "feetMin": min(bbox[3] for bbox in bboxes),
        "feetMax": max(bbox[3] for bbox in bboxes),
        "adjacentDeltaMean": float(np.mean(adjacent)) if adjacent else 0.0,
        "loopSeamDelta": frame_delta(cells[-1], cells[0]) if len(cells) > 1 else 0.0,
    }


def split_cells(sheet: np.ndarray, count: int) -> list[np.ndarray]:
    cells: list[np.ndarray] = []
    for index in range(count):
        row, col = divmod(index, COLS)
        cells.append(
            sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL].copy()
        )
    return cells


def recolour_bartender(cell: np.ndarray) -> np.ndarray:
    """Turn neutral workwear into burgundy vest/apron without moving alpha."""
    result = cell.copy()
    rgb = result[..., :3].astype(np.float32)
    alpha = result[..., 3] > 10
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    chroma = maximum - minimum
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722

    yy, xx = np.indices(alpha.shape)
    # All source cells are torso-anchored at x=128.  Keep the charcoal cap and
    # trousers, recolour the open upper garment, then extend a narrow apron panel.
    vest_region = (yy >= 78) & (yy <= 165) & (xx >= 57) & (xx <= 199)
    apron_region = (yy >= 133) & (yy <= 205) & (xx >= 92) & (xx <= 164)
    neutral_dark = (luminance >= 18) & (luminance <= 132) & (chroma <= 48)
    garment = alpha & neutral_dark & (vest_region | apron_region)

    # Preserve the source shading and material grain while directing hue toward
    # restrained dark wine red.  This is deliberately not a flat colour fill.
    wine = np.stack(
        (
            np.clip(luminance * 1.18 + 19, 28, 146),
            np.clip(luminance * 0.39 + 5, 10, 58),
            np.clip(luminance * 0.54 + 9, 18, 78),
        ),
        axis=2,
    )
    rgb[garment] = rgb[garment] * 0.22 + wine[garment] * 0.78

    # Existing small fasteners are warm-neutral.  Give only compact, bright
    # torso highlights a muted old-brass cast; cream shirt pixels are excluded
    # by the luminance ceiling and the narrow side bands.
    side_bands = ((xx >= 78) & (xx <= 106)) | ((xx >= 150) & (xx <= 178))
    brass = (
        alpha
        & vest_region
        & side_bands
        & (luminance >= 70)
        & (luminance <= 142)
        & (chroma <= 34)
    )
    brass_tone = np.stack(
        (
            np.clip(luminance * 1.18 + 30, 95, 190),
            np.clip(luminance * 0.85 + 15, 65, 145),
            np.clip(luminance * 0.39 + 5, 25, 74),
        ),
        axis=2,
    )
    rgb[brass] = rgb[brass] * 0.55 + brass_tone[brass] * 0.45

    result[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return result


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 62, 88)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * CELL, COLS * CELL, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL] = cell
    return sheet


def save_previews(name: str, cells: list[np.ndarray], fps: float) -> None:
    frames = [checker(cell) for cell in cells]
    playback = frames * 3
    playback[0].save(
        PREVIEWS / f"{name}.gif",
        save_all=True,
        append_images=playback[1:],
        duration=max(20, round(1000 / fps)),
        loop=0,
        optimize=False,
    )
    contact = Image.new(
        "RGB", (COLS * CELL, math.ceil(len(cells) / COLS) * CELL), "#20242a"
    )
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    draw = ImageDraw.Draw(contact)
    draw.text((8, 8), f"bartender {name} | feetY {FEET_Y}/{CELL}", fill="#f0d7a2")
    contact.save(PREVIEWS / f"{name}-contact.jpg", quality=92)


def main() -> None:
    SHEETS.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    source_report = json.loads(
        (SOURCE_ROOT / "sheet-report.json").read_text(encoding="utf-8")
    )
    report: dict[str, object] = {
        "status": "review-only; not connected to runtime configuration",
        "cell": CELL,
        "feetY": FEET_Y,
        "sourceMotionSet": "assets/companions/hamster_boiler_worker",
        "styleTransform": "local deterministic burgundy vest/apron and muted brass recolour",
        "model": None,
        "externalUpload": False,
        "actions": {},
    }
    for action, cfg in ACTIONS.items():
        source_path = SOURCE_SHEETS / f"{action}.png"
        source_sheet = np.asarray(Image.open(source_path).convert("RGBA"))
        source_cells = split_cells(source_sheet, cfg["count"])
        cells = [recolour_bartender(cell) for cell in source_cells]

        # Geometry must remain identical: the costume pass may change RGB only.
        for index, (source, result) in enumerate(zip(source_cells, cells)):
            if not np.array_equal(source[..., 3], result[..., 3]):
                raise RuntimeError(f"{action} frame {index} changed alpha geometry")

        output_path = SHEETS / f"{action}.png"
        Image.fromarray(compose(cells), "RGBA").save(
            output_path, optimize=True, compress_level=9
        )
        save_previews(action, cells, cfg["frameRate"])
        source_action = source_report["actions"][action]
        report["actions"][action] = {
            "output": str(output_path.relative_to(REPO)).replace("\\", "/"),
            "source": source_action["source"],
            "window": source_action["window"],
            "sourceIndices": source_action["sourceIndices"],
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": CELL,
            "frameHeight": CELL,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": cfg["frameRate"],
            "footRatio": FEET_Y / CELL,
            "validation": validate_cells(cells),
        }

    (OUT / "sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
