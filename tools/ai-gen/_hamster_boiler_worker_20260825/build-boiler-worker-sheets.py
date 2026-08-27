#!/usr/bin/env python3
"""Rebuild four hamster boiler-worker videos into compact transparent sheets."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BASE_SCRIPT = REPO / "tools" / "ai-gen" / "jungle-wizard-video-rebuild.py"
SPEC = importlib.util.spec_from_file_location("boiler_worker_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

CELL = 256
FEET_Y = 236
TARGET_HEIGHT = 218
COLS = 4
ACTIONS = {
    "idle": {"count": 8, "frameRate": 8, "video": "idle-closed-mouth.mp4"},
    "empty_running": {"count": 12, "frameRate": 12, "video": "empty-running.mp4"},
    "food_loaded_running": {"count": 12, "frameRate": 12, "video": "food-loaded-running.mp4"},
    "energy_loaded_running": {"count": 12, "frameRate": 12, "video": "energy-loaded-running.mp4"},
}


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 62, 88)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def place_cell(rgba: np.ndarray, anchor: float, scale: float) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    )
    offset_x = round(CELL / 2 - (anchor - x0) * scale)
    offset_y = FEET_Y - height
    if offset_x < 3 or offset_y < 3 or offset_x + width > CELL - 3 or offset_y + height > CELL - 3:
        raise RuntimeError(f"Boiler worker placement clips: {width}x{height} at {offset_x},{offset_y}")
    cell = np.zeros((CELL, CELL, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * CELL, COLS * CELL, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL] = cell
    return sheet


def save_previews(name: str, cells: list[np.ndarray], fps: float, out_dir: Path) -> None:
    frames = [checker(cell) for cell in cells]
    playback = frames * 3
    playback[0].save(
        out_dir / f"{name}.gif",
        save_all=True,
        append_images=playback[1:],
        duration=max(20, round(1000 / fps)),
        loop=0,
        optimize=False,
    )
    contact = Image.new("RGB", (COLS * CELL, math.ceil(len(cells) / COLS) * CELL), "#20242a")
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    contact.save(out_dir / f"{name}-contact.jpg", quality=92)


def main() -> None:
    windows = json.loads((ROOT / "windows.json").read_text(encoding="utf-8"))
    runtime_dir = REPO / "assets" / "companions" / "hamster_boiler_worker"
    preview_dir = ROOT / "previews" / "sheets"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    model = BASE.get_model()

    picked: dict[str, tuple[int, ...]] = {}
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    for action, action_cfg in ACTIONS.items():
        video = ROOT / "videos" / action_cfg["video"]
        frames, _ = BASE.decode_video(video)
        start, endpoint = windows[action]
        if not (0 <= start < endpoint < len(frames)):
            raise RuntimeError(f"Invalid {action} window {start}:{endpoint}")
        indices = BASE.visual_resample_indices(frames, start, endpoint, action_cfg["count"])
        picked[action] = indices
        for index in sorted(set((*indices, endpoint))):
            cutouts[(action, index)] = BASE.cutout_rgba(frames[index], model)
            print(f"[boiler-worker-sheet] {action} BiRefNet f{index}", flush=True)

    reference = cutouts[("idle", picked["idle"][0])]
    _, ref_y0, _, ref_y1 = BASE.alpha_bbox(reference)
    scale = TARGET_HEIGHT / (ref_y1 - ref_y0 + 1)
    for rgba in cutouts.values():
        x0, _, x1, _ = BASE.alpha_bbox(rgba)
        anchor = BASE.horizontal_anchor(rgba, "torso")
        half_span = max(anchor - x0, x1 - anchor + 1)
        scale = min(scale, (CELL / 2 - 6) / max(1, half_span))

    report: dict[str, object] = {
        "cell": CELL,
        "feetY": FEET_Y,
        "targetHeight": TARGET_HEIGHT,
        "fixedScale": scale,
        "actions": {},
    }
    for action, action_cfg in ACTIONS.items():
        indices = picked[action]
        cells = [
            place_cell(
                cutouts[(action, index)],
                BASE.horizontal_anchor(cutouts[(action, index)], "torso"),
                scale,
            )
            for index in indices
        ]
        Image.fromarray(compose(cells), "RGBA").save(
            runtime_dir / f"{action}.png", optimize=True, compress_level=9
        )
        save_previews(action, cells, action_cfg["frameRate"], preview_dir)
        report["actions"][action] = {
            "source": f"videos/{action_cfg['video']}",
            "window": windows[action],
            "sourceIndices": list(indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": CELL,
            "frameHeight": CELL,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": action_cfg["frameRate"],
            "footRatio": FEET_Y / CELL,
            "validation": BASE.validate_cells(cells, -1),
        }

    (ROOT / "sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
