#!/usr/bin/env python3
"""Build fixed-scale farmer delivery sheets from approved MiniMax H3 videos."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BASE_SCRIPT = REPO / "tools" / "ai-gen" / "jungle-wizard-video-rebuild.py"
SPEC = importlib.util.spec_from_file_location("corn_farmer_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


CELL = 512
FEET_Y = 420
TARGET_HEIGHT = 398
COLS = 8


def remove_long_tail(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove only the thin mouse-like tail invented behind the farmer."""

    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    height = y1 - y0 + 1
    anchor = BASE.horizontal_anchor(rgba, "torso")
    alpha = rgba[..., 3]
    mask = alpha > 12
    core_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    reach_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    core = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, core_kernel) > 0
    near_core = cv2.dilate(core.astype(np.uint8), reach_kernel) > 0
    yy, xx = np.indices(mask.shape)
    rear_lower = (
        (xx < anchor - height * 0.02)
        & (yy > y0 + height * 0.38)
        & (yy < y0 + height * 0.90)
    )
    # H3 sometimes renders the tail thick enough to survive the morphology
    # pass.  Clip only the far-rear strip around the tail's horizontal run;
    # the y window stops above the feet and leaves a short hamster tail stump.
    far_tail = (
        (xx < anchor - height * 0.34)
        & (yy > y0 + height * 0.70)
        & (yy < y0 + height * 0.86)
    )
    remove = mask & ((rear_lower & ~near_core) | far_tail)
    cleaned = rgba.copy()
    cleaned[remove] = 0
    cleaned[cleaned[..., 3] == 0, :3] = 0
    return cleaned, int(remove.sum())


def place_cell(rgba: np.ndarray, scale: float) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    anchor = BASE.horizontal_anchor(rgba, "torso")
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    )
    local_anchor = (anchor - x0) * scale
    offset_x = round(CELL / 2 - local_anchor)
    offset_y = FEET_Y - height + 1
    if offset_x < 3 or offset_y < 3 or offset_x + width > CELL - 3 or offset_y + height > CELL - 3:
        raise RuntimeError(f"Placement clips: {width}x{height} at ({offset_x},{offset_y})")
    cell = np.zeros((CELL, CELL, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    cell[cell[..., 3] == 0, :3] = 0
    return cell


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 62, 88)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(
        np.clip(cell[..., :3] * alpha + background * (1.0 - alpha), 0, 255).astype(np.uint8),
        "RGB",
    )


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * CELL, COLS * CELL, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL] = cell
    return sheet


def save_previews(name: str, cells: list[np.ndarray], fps: float, preview_dir: Path) -> None:
    frames = [checker(cell) for cell in cells]
    playback = frames * 3
    playback[0].save(
        preview_dir / f"{name}-base.gif",
        save_all=True,
        append_images=playback[1:],
        duration=round(1000 / fps),
        loop=0,
        disposal=2,
        optimize=False,
    )
    rows = math.ceil(len(cells) / COLS)
    contact = Image.new("RGB", (COLS * CELL, rows * CELL), "#20242a")
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    contact.save(preview_dir / f"{name}-base-contact.jpg", quality=93)


def main() -> None:
    spec = json.loads((ROOT / "cycle-windows.json").read_text(encoding="utf-8"))
    actions = spec["actions"]
    video_dir = ROOT / "videos"
    out_dir = ROOT / "video-sheets" / "base"
    preview_dir = ROOT / "previews" / "base"
    out_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.get_model()
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    removed: dict[tuple[str, int], int] = {}
    decoded: dict[str, tuple[list[np.ndarray], float]] = {}
    for action, cfg in actions.items():
        frames, fps = BASE.decode_video(video_dir / cfg["video"])
        if abs(fps - 24.0) > 0.01 or len(frames) != 124:
            raise RuntimeError(f"{action}: expected 124 frames at 24fps, got {len(frames)} at {fps}")
        decoded[action] = (frames, fps)
        for index in range(cfg["start"], cfg["endpoint"], cfg["step"]):
            rgba = BASE.cutout_rgba(frames[index], model)
            rgba, removed_pixels = remove_long_tail(rgba)
            cutouts[(action, index)] = rgba
            removed[(action, index)] = removed_pixels
            print(f"[corn-farmer-sheet] {action} BiRefNet f{index} tail={removed_pixels}", flush=True)

    scales: dict[str, float] = {}
    median_source_heights: dict[str, float] = {}
    for action, cfg in actions.items():
        indices = list(range(cfg["start"], cfg["endpoint"], cfg["step"]))
        heights = []
        for index in indices:
            _, y0, _, y1 = BASE.alpha_bbox(cutouts[(action, index)])
            heights.append(y1 - y0 + 1)
        median_height = float(np.median(heights))
        scale = TARGET_HEIGHT / median_height
        for index in indices:
            rgba = cutouts[(action, index)]
            x0, _, x1, _ = BASE.alpha_bbox(rgba)
            anchor = BASE.horizontal_anchor(rgba, "torso")
            half_span = max(anchor - x0, x1 - anchor + 1)
            scale = min(scale, (CELL / 2 - 8) / max(1, half_span))
        scales[action] = scale
        median_source_heights[action] = median_height

    report: dict[str, object] = {
        "pipeline": "MiniMax H3 Ref2VA -> BiRefNet-general -> narrow long-tail cleanup -> per-action median visible-height normalization and fixed foot anchor",
        "cell": CELL,
        "feetY": FEET_Y,
        "targetHeight": TARGET_HEIGHT,
        "fixedScaleByAction": scales,
        "actions": {},
    }
    for action, cfg in actions.items():
        indices = list(range(cfg["start"], cfg["endpoint"], cfg["step"]))
        cells = [place_cell(cutouts[(action, index)], scales[action]) for index in indices]
        sheet_path = out_dir / f"{action}-base.png"
        Image.fromarray(compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        save_previews(action, cells, cfg["frameRate"], preview_dir)
        report["actions"][action] = {
            "source": f"videos/{cfg['video']}",
            "window": [cfg["start"], cfg["endpoint"]],
            "duplicateEndpointExcluded": cfg["endpoint"],
            "sourceIndices": indices,
            "sourceFrameStep": cfg["step"],
            "frameCount": len(cells),
            "frameWidth": CELL,
            "frameHeight": CELL,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": cfg["frameRate"],
            "sourceVisibleHeightMedian": median_source_heights[action],
            "fixedScale": scales[action],
            "tailPixelsRemoved": [removed[(action, index)] for index in indices],
            "validation": BASE.validate_cells(cells, -1),
        }

    (ROOT / "video-sheets" / "base-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
