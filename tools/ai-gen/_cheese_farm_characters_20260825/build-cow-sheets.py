#!/usr/bin/env python3
"""Build transparent Holstein cow candidate sheets from MiniMax H3 videos."""

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
CHARACTER_BUILDER = ROOT / "build-character-sheets.py"
SPEC = importlib.util.spec_from_file_location("cheese_farm_character_builder", CHARACTER_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import character helper: {CHARACTER_BUILDER}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


CELL_W = 384
CELL_H = 256
FEET_Y = 236
TARGET_WIDTH = 350
MAX_HEIGHT = 220
COW_FIXED_SCALE = 0.5147058823529411
COLS = 3
ACTIONS = {
    "holstein_cow_walking": {
        "video": "holstein-cow-walking-h3-v01.mp4",
        # Analyzer-confirmed 46-source-frame gait cycle; frame 70 repeats frame 24's phase.
        "indices": list(range(24, 70, 2)),
        "frameRate": 12,
    },
    "holstein_cow_grazing": {
        "video": "holstein-cow-grazing-h3-v01.mp4",
        # Full stand->lower->graze->raise cycle; frame 100 repeats frame 4's phase.
        "indices": [4, 10, 16, 22, 28, 34, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94],
        "frameRate": 4,
    },
}


def place_cell(rgba: np.ndarray, scale: float) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    )
    offset_x = (CELL_W - width) // 2
    offset_y = FEET_Y - height
    if offset_x < 3 or offset_y < 3 or offset_x + width > CELL_W - 3 or offset_y + height > CELL_H - 3:
        raise RuntimeError(f"Cow placement clips: {width}x{height} at {offset_x},{offset_y}")
    cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * CELL_H, COLS * CELL_W, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W] = cell
    return sheet


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 62, 88)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(
        np.clip(cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha), 0, 255).astype(np.uint8),
        "RGB",
    )


def save_previews(name: str, cells: list[np.ndarray], fps: float) -> tuple[Path, Path]:
    preview_dir = ROOT / "previews" / "sheets"
    preview_dir.mkdir(parents=True, exist_ok=True)
    frames = [checker(cell) for cell in cells]
    playback = frames * 3
    gif = preview_dir / f"{name}.gif"
    playback[0].save(
        gif,
        save_all=True,
        append_images=playback[1:],
        duration=max(20, round(1000 / fps)),
        loop=0,
        optimize=False,
    )
    rows = math.ceil(len(cells) / COLS)
    contact = Image.new("RGB", (COLS * CELL_W, rows * CELL_H), "#20242a")
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL_W, (index // COLS) * CELL_H))
    contact_path = preview_dir / f"{name}-contact.jpg"
    contact.save(contact_path, quality=92)
    return gif, contact_path


def main() -> None:
    sheets = ROOT / "sheets"
    sheets.mkdir(parents=True, exist_ok=True)
    model = BASE.get_model()
    report: dict[str, object] = {
        "frameWidth": CELL_W,
        "frameHeight": CELL_H,
        "feetY": FEET_Y,
        "actions": {},
    }

    for name, cfg in ACTIONS.items():
        video = ROOT / "videos" / cfg["video"]
        frames, _ = BASE.decode_video(video)
        indices = cfg["indices"]
        if any(index < 0 or index >= len(frames) for index in indices):
            raise RuntimeError(f"{name}: source index outside {len(frames)} decoded frames")
        cutouts = []
        for index in indices:
            cutouts.append(HELPER.green_cutout(frames[index], model))
            print(f"[cheese-farm-cow-sheet] {name} BiRefNet f{index}", flush=True)

        scale = float("inf")
        for rgba in cutouts:
            x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
            width = x1 - x0 + 1
            height = y1 - y0 + 1
            scale = min(
                scale,
                TARGET_WIDTH / max(1, width),
                MAX_HEIGHT / max(1, height),
                (CELL_W - 6) / max(1, width),
                (FEET_Y - 3) / max(1, height),
            )
        scale = min(scale, COW_FIXED_SCALE)

        cells = [place_cell(rgba, scale) for rgba in cutouts]
        sheet_path = sheets / f"{name}.png"
        Image.fromarray(compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        gif, contact = save_previews(name, cells, cfg["frameRate"])
        report["actions"][name] = {
            "source": f"videos/{cfg['video']}",
            "sourceIndices": indices,
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": CELL_W,
            "frameHeight": CELL_H,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": cfg["frameRate"],
            "footRatio": FEET_Y / CELL_H,
            "fixedScale": scale,
            "sheet": str(sheet_path.relative_to(REPO)).replace("\\", "/"),
            "previewGif": str(gif.relative_to(REPO)).replace("\\", "/"),
            "previewContact": str(contact.relative_to(REPO)).replace("\\", "/"),
            "validation": BASE.validate_cells(cells, -1),
        }

    (ROOT / "cow-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
