#!/usr/bin/env python3
"""Rebuild five approved hamster residents into compact transparent sheets.

The hand-reviewed windows.json supplies one natural source cycle per action.
Frames are sampled by accumulated visual distance, then every resident uses one
fixed scale and foot line across idle/walking. Runtime output is deliberately
limited to 256px cells (8 idle frames, 12 walking frames).
"""

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
SPEC = importlib.util.spec_from_file_location("resident_sprite_base", BASE_SCRIPT)
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
    "idle": {"count": 8, "frameRate": 8},
    "walking": {"count": 12, "frameRate": 12},
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
        raise RuntimeError(
            f"Resident placement clips: {width}x{height} at {offset_x},{offset_y}"
        )
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
    windows_path = ROOT / "windows.json"
    windows = json.loads(windows_path.read_text(encoding="utf-8"))
    runtime_root = REPO / "assets" / "companions" / "hamster_residents"
    preview_root = ROOT / "previews" / "sheets"
    runtime_root.mkdir(parents=True, exist_ok=True)
    preview_root.mkdir(parents=True, exist_ok=True)
    model = BASE.get_model()
    report: dict[str, object] = {"cell": CELL, "feetY": FEET_Y, "residents": {}}

    for resident_number in range(1, 6):
        resident_id = f"resident_{resident_number:02d}"
        decoded: dict[str, tuple[list[np.ndarray], float]] = {}
        picked: dict[str, tuple[int, ...]] = {}
        cutouts: dict[tuple[str, int], np.ndarray] = {}
        action_windows = windows[resident_id]
        for action, action_cfg in ACTIONS.items():
            video = ROOT / "videos" / f"resident-{resident_number:02d}-{action}.mp4"
            frames, source_fps = BASE.decode_video(video)
            start, endpoint = action_windows[action]
            if not (0 <= start < endpoint < len(frames)):
                raise RuntimeError(f"Invalid {resident_id}/{action} window {start}:{endpoint}")
            indices = BASE.visual_resample_indices(
                frames,
                start,
                endpoint,
                action_cfg["count"],
            )
            decoded[action] = (frames, source_fps)
            picked[action] = indices
            for index in sorted(set((*indices, endpoint))):
                cutouts[(action, index)] = BASE.cutout_rgba(frames[index], model)
                print(f"[resident-sheet] {resident_id}/{action} BiRefNet f{index}", flush=True)

        # One fixed scale per outfit across both actions. Width limits can only reduce it.
        reference = cutouts[("idle", picked["idle"][0])]
        _, ref_y0, _, ref_y1 = BASE.alpha_bbox(reference)
        scale = TARGET_HEIGHT / (ref_y1 - ref_y0 + 1)
        for (action, index), rgba in cutouts.items():
            x0, _, x1, _ = BASE.alpha_bbox(rgba)
            anchor = BASE.horizontal_anchor(rgba, "torso")
            half_span = max(anchor - x0, x1 - anchor + 1)
            scale = min(scale, (CELL / 2 - 6) / max(1, half_span))

        runtime_dir = runtime_root / resident_id
        preview_dir = preview_root / resident_id
        runtime_dir.mkdir(parents=True, exist_ok=True)
        preview_dir.mkdir(parents=True, exist_ok=True)
        resident_report: dict[str, object] = {"fixedScale": scale, "actions": {}}
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
            sheet = compose(cells)
            Image.fromarray(sheet, "RGBA").save(
                runtime_dir / f"{action}.png", optimize=True, compress_level=9
            )
            save_previews(action, cells, action_cfg["frameRate"], preview_dir)
            validation = BASE.validate_cells(cells, -1)
            resident_report["actions"][action] = {
                "source": f"videos/resident-{resident_number:02d}-{action}.mp4",
                "window": action_windows[action],
                "sourceIndices": list(indices),
                "frameCount": len(cells),
                "endFrame": len(cells) - 1,
                "frameWidth": CELL,
                "frameHeight": CELL,
                "cols": COLS,
                "rows": math.ceil(len(cells) / COLS),
                "frameRate": action_cfg["frameRate"],
                "validation": validation,
            }
        report["residents"][resident_id] = resident_report

    (ROOT / "sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
