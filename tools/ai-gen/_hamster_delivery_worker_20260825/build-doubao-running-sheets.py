#!/usr/bin/env python3
"""Rebuild approved Doubao delivery-worker run cycles into RGBA base sheets."""

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
SPEC = importlib.util.spec_from_file_location("delivery_worker_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


CELL = 512
FEET_Y = 479
TARGET_HEIGHT = 312
COLS = 4

ACTIONS = {
    "empty_running": {
        "video": "delivery-worker-empty-running-doubao-v2.mp4",
        "start": 48,
        "endpoint": 72,
        "step": 2,
        "frameRate": 12,
    },
    "loaded_running": {
        "video": "delivery-worker-loaded-running-doubao-v1-source-tail-cleanup.mp4",
        "start": 52,
        "endpoint": 84,
        "step": 2,
        "frameRate": 12,
    },
}


def remove_long_tail(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove the thin mouse-like tail invented by Seedance.

    The operation is limited to the lower rear quadrant. Thick connected body,
    satchel and legs survive via an opened/dilated core; only thin pixels that
    extend far behind that core are removed. A short proximal stub may remain,
    which reads as a hamster tail rather than a mouse tail.
    """

    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    height = y1 - y0 + 1
    anchor = BASE.horizontal_anchor(rgba, "torso")
    alpha = rgba[..., 3]
    mask = alpha > 12

    core_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    reach_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    core = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, core_kernel) > 0
    near_core = cv2.dilate(core.astype(np.uint8), reach_kernel) > 0

    yy, xx = np.indices(mask.shape)
    rear_lower = (
        (xx < anchor - height * 0.08)
        & (yy > y0 + height * 0.42)
        & (yy < y0 + height * 0.88)
    )
    remove = mask & rear_lower & ~near_core
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
        preview_dir / f"delivery-worker-{name.replace('_', '-')}-base.gif",
        save_all=True,
        append_images=playback[1:],
        duration=round(1000 / fps),
        loop=0,
        disposal=2,
        optimize=False,
    )
    contact = Image.new("RGB", (COLS * CELL, math.ceil(len(cells) / COLS) * CELL), "#20242a")
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    contact.save(preview_dir / f"delivery-worker-{name.replace('_', '-')}-base-contact.jpg", quality=93)


def main() -> None:
    video_dir = ROOT / "videos"
    out_dir = ROOT / "video-sheets" / "base"
    preview_dir = ROOT / "previews" / "video-sheets" / "base"
    out_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.get_model()
    decoded: dict[str, tuple[list[np.ndarray], float]] = {}
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    removed: dict[tuple[str, int], int] = {}

    for action, cfg in ACTIONS.items():
        frames, fps = BASE.decode_video(video_dir / cfg["video"])
        if abs(fps - 24.0) > 0.01 or len(frames) != 121:
            raise RuntimeError(f"{action}: expected 121 frames at 24fps, got {len(frames)} at {fps}")
        decoded[action] = (frames, fps)
        indices = list(range(cfg["start"], cfg["endpoint"], cfg["step"]))
        for index in indices:
            rgba = BASE.cutout_rgba(frames[index], model)
            rgba, removed_pixels = remove_long_tail(rgba)
            cutouts[(action, index)] = rgba
            removed[(action, index)] = removed_pixels
            print(f"[delivery-worker-sheet] {action} BiRefNet f{index} tail={removed_pixels}", flush=True)

    reference = cutouts[("empty_running", ACTIONS["empty_running"]["start"])]
    _, ref_y0, _, ref_y1 = BASE.alpha_bbox(reference)
    scale = TARGET_HEIGHT / (ref_y1 - ref_y0 + 1)
    for rgba in cutouts.values():
        x0, _, x1, _ = BASE.alpha_bbox(rgba)
        anchor = BASE.horizontal_anchor(rgba, "torso")
        half_span = max(anchor - x0, x1 - anchor + 1)
        scale = min(scale, (CELL / 2 - 8) / max(1, half_span))

    report: dict[str, object] = {
        "status": "candidate-only; RIFE interpolation and user acceptance still required",
        "cell": CELL,
        "feetY": FEET_Y,
        "targetHeight": TARGET_HEIGHT,
        "fixedScale": scale,
        "actions": {},
    }
    for action, cfg in ACTIONS.items():
        indices = list(range(cfg["start"], cfg["endpoint"], cfg["step"]))
        cells = [place_cell(cutouts[(action, index)], scale) for index in indices]
        sheet_path = out_dir / f"delivery-worker-{action.replace('_', '-')}-base.png"
        Image.fromarray(compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        save_previews(action, cells, cfg["frameRate"], preview_dir)
        report["actions"][action] = {
            "source": f"videos/{cfg['video']}",
            "window": [cfg["start"], cfg["endpoint"]],
            "duplicateEndpointExcluded": cfg["endpoint"],
            "sourceIndices": indices,
            "sourceFrameStep": cfg["step"],
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": CELL,
            "frameHeight": CELL,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": cfg["frameRate"],
            "tailPixelsRemoved": [removed[(action, index)] for index in indices],
            "validation": BASE.validate_cells(cells, -1),
        }

    (ROOT / "video-sheets" / "base-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
