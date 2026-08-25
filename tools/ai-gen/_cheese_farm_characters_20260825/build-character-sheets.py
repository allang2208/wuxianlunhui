#!/usr/bin/env python3
"""Build transparent cheese-farm character candidate sheets from H3 videos."""

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
SPEC = importlib.util.spec_from_file_location("cheese_farm_character_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


CELL = 256
FEET_Y = 236
TARGET_HEIGHT = 218
COLS = 4
GREEN_MATTE = np.array([0.0, 255.0, 0.0], dtype=np.float32)
ACTIONS = {
    "cowherd_idle": {
        "video": "cowherd-idle-h3-v02.mp4",
        # Closed-mouth natural trajectory across the exact last->first lock.
        "indices": [78, 89, 101, 112, 123, 11, 22, 34],
        "frameRate": 8,
    },
    "cowherd_empty_running": {
        "video": "cowherd-empty-running-h3-v01.mp4",
        # One natural 18-source-frame gait cycle; frame 30 repeats frame 12's phase.
        "indices": [12, 14, 16, 18, 20, 22, 24, 26, 28],
        "frameRate": 12,
    },
    "cowherd_carrying_cheese_running": {
        "video": "cowherd-carrying-cheese-running-h3-v01.mp4",
        # Stable held-cheese 16-source-frame gait; frame 28 repeats frame 12's phase.
        "indices": [12, 14, 16, 18, 20, 22, 24, 26],
        "frameRate": 12,
    },
}


def green_cutout(rgb: np.ndarray, model) -> np.ndarray:
    alpha = np.squeeze(np.asarray(BASE.predict_alpha(model, Image.fromarray(rgb, "RGB"))))
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = BASE.keep_subject_component(np.clip(alpha, 0, 255).astype(np.uint8))

    clean_rgb = rgb.astype(np.float32)
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        af = a[semi, None]
        # Very low-alpha edge pixels are numerically unstable when the green
        # matte is fully unpremultiplied; clamp only the decontamination divisor
        # so fine tails and whiskers do not turn magenta.
        stable_af = np.maximum(af, 0.25)
        clean_rgb[semi] = np.clip(
            (clean_rgb[semi] - (1.0 - af) * GREEN_MATTE) / stable_af,
            0,
            255,
        )
    clean_rgb[a <= 0.02] = 0
    return np.dstack((clean_rgb.astype(np.uint8), alpha))


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
        raise RuntimeError(f"Cowherd placement clips: {width}x{height} at {offset_x},{offset_y}")
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
    contact = Image.new("RGB", (COLS * CELL, math.ceil(len(cells) / COLS) * CELL), "#20242a")
    for index, frame in enumerate(frames):
        contact.paste(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    contact_path = preview_dir / f"{name}-contact.jpg"
    contact.save(contact_path, quality=92)
    return gif, contact_path


def main() -> None:
    sheets = ROOT / "sheets"
    sheets.mkdir(parents=True, exist_ok=True)
    model = BASE.get_model()
    report: dict[str, object] = {"cell": CELL, "feetY": FEET_Y, "actions": {}}

    for name, cfg in ACTIONS.items():
        video = ROOT / "videos" / cfg["video"]
        frames, _ = BASE.decode_video(video)
        indices = cfg["indices"]
        if any(index < 0 or index >= len(frames) for index in indices):
            raise RuntimeError(f"{name}: source index outside {len(frames)} decoded frames")
        cutouts = []
        for index in indices:
            cutouts.append(green_cutout(frames[index], model))
            print(f"[cheese-farm-sheet] {name} BiRefNet f{index}", flush=True)

        _, ref_y0, _, ref_y1 = BASE.alpha_bbox(cutouts[0])
        scale = TARGET_HEIGHT / (ref_y1 - ref_y0 + 1)
        for rgba in cutouts:
            x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
            anchor = BASE.horizontal_anchor(rgba, "torso")
            half_span = max(anchor - x0, x1 - anchor + 1)
            scale = min(scale, (CELL / 2 - 6) / max(1, half_span))
            scale = min(scale, (FEET_Y - 3) / max(1, y1 - y0 + 1))

        cells = [
            place_cell(rgba, BASE.horizontal_anchor(rgba, "torso"), scale)
            for rgba in cutouts
        ]
        sheet_path = sheets / f"{name}.png"
        Image.fromarray(compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        gif, contact = save_previews(name, cells, cfg["frameRate"])
        report["actions"][name] = {
            "source": f"videos/{cfg['video']}",
            "sourceIndices": indices,
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": CELL,
            "frameHeight": CELL,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "frameRate": cfg["frameRate"],
            "footRatio": FEET_Y / CELL,
            "fixedScale": scale,
            "sheet": str(sheet_path.relative_to(REPO)).replace("\\", "/"),
            "previewGif": str(gif.relative_to(REPO)).replace("\\", "/"),
            "previewContact": str(contact.relative_to(REPO)).replace("\\", "/"),
            "validation": BASE.validate_cells(cells, -1),
        }

    (ROOT / "sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
