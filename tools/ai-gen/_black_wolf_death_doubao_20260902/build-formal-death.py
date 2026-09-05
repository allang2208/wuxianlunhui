#!/usr/bin/env python3
"""Build the compact black-wolf death atlas with one RIFE pass."""

from __future__ import annotations

import json
import math
import runpy
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOLS = ROOT.parent
COMMON = runpy.run_path(str(TOOLS / "character-run-video-rebuild.py"))
decode = COMMON["decode"]
cutout = COMMON["cutout"]
bbox = COMMON["bbox"]
lower_body_anchor = COMMON["lower_body_anchor"]
get_model = COMMON["get_model"]

VIDEO = ROOT / "videos/black-wolf-dying-doubao-v01.mp4"
SOURCE_FRAMES = list(range(0, 65, 4))
SOURCE_DURATION_MS = 2667
SOURCE_DIR = ROOT / "spritesheets/formal-source-pre-rife"
FINAL_DIR = ROOT / "spritesheets/formal-final"
REPORT_DIR = ROOT / "reports/sprites/formal-final"
PREVIEW_DIR = ROOT / "previews/sprites/formal-final/death"
SOURCE_SHEET = SOURCE_DIR / "death.png"
FINAL_SHEET = FINAL_DIR / "death.png"
RIFE_REPORT = REPORT_DIR / "death-rife.json"
RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (REPO.parent / "_tmp/elise_audit/rife"
            / "rife-ncnn-vulkan-20221029-windows/rife-ncnn-vulkan.exe")
RUNTIME_ASSET = REPO / "assets/enemies/black_wolf_dying.png"

TARGET_STANDING_HEIGHT = 228
# Existing black-wolf sheets render their visible paw bottom 15 source pixels
# below the logical root (512/2 + 41/(151/512) = 395; alpha bottom = 410).
# Retain that accepted runtime relationship when switching into death.
RUNTIME_ROOT_ABOVE_VISIBLE_BOTTOM = 15
PAD = 14
SOURCE_COLS = 5
FINAL_COLS = 5


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def round32(value: int) -> int:
    return max(64, math.ceil(value / 32) * 32)


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    height, width = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * height, cols * width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def extract_cells(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [sheet[(i // cols) * height:(i // cols + 1) * height,
                  (i % cols) * width:(i % cols + 1) * width].copy() for i in range(count)]


def build_cells(frames: list[np.ndarray], model) -> tuple[list[np.ndarray], dict]:
    cutouts: dict[int, np.ndarray] = {}
    for source_index in SOURCE_FRAMES:
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[black-wolf-death] BiRefNet f{source_index}", flush=True)

    reference = cutouts[SOURCE_FRAMES[0]]
    rx0, ry0, rx1, ry1 = bbox(reference)
    reference_height = ry1 - ry0 + 1
    scale = TARGET_STANDING_HEIGHT / reference_height
    root_x = lower_body_anchor(reference)
    root_y = ry1

    prepared = []
    global_left = global_top = float("inf")
    global_right = global_bottom = float("-inf")
    for source_index in SOURCE_FRAMES:
        rgba = cutouts[source_index]
        x0, y0, x1, y1 = bbox(rgba)
        crop = rgba[y0:y1 + 1, x0:x1 + 1]
        size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        left = (x0 - root_x) * scale
        top = (y0 - root_y) * scale
        right = left + resized.shape[1]
        bottom = top + resized.shape[0]
        global_left = min(global_left, left)
        global_top = min(global_top, top)
        global_right = max(global_right, right)
        global_bottom = max(global_bottom, bottom)
        prepared.append((source_index, resized, left, top))

    width = round32(math.ceil(global_right - global_left + PAD * 2))
    height = round32(math.ceil(global_bottom - global_top + PAD * 2))
    anchor_x = round(PAD - global_left)
    foot_y = round(PAD - global_top)
    cells = []
    placements = []
    for source_index, resized, left, top in prepared:
        x = round(anchor_x + left)
        y = round(foot_y + top)
        if x < 3 or y < 3 or x + resized.shape[1] > width - 3 or y + resized.shape[0] > height - 3:
            raise RuntimeError(f"f{source_index} clips: {resized.shape[1]}x{resized.shape[0]} at {x},{y}")
        cell = np.zeros((height, width, 4), dtype=np.uint8)
        cell[y:y + resized.shape[0], x:x + resized.shape[1]] = resized
        cell[cell[..., 3] == 0, :3] = 0
        cells.append(cell)
        placements.append({
            "sourceFrame": source_index,
            "x": x,
            "y": y,
            "width": resized.shape[1],
            "height": resized.shape[0],
        })
    return cells, {
        "referenceSourceFrame": SOURCE_FRAMES[0],
        "referenceSourceBbox": [rx0, ry0, rx1, ry1],
        "referenceSourceHeight": reference_height,
        "fixedScale": scale,
        "targetStandingHeight": TARGET_STANDING_HEIGHT,
        "frameWidth": width,
        "frameHeight": height,
        "footX": anchor_x,
        "footY": foot_y - RUNTIME_ROOT_ABOVE_VISIBLE_BOTTOM,
        "visualBottomRootY": foot_y,
        "runtimeRootAboveVisibleBottom": RUNTIME_ROOT_ABOVE_VISIBLE_BOTTOM,
        "placements": placements,
        "alignmentMode": "single fixed scale plus source-frame whole-body coordinates; no per-frame recenter or resize; runtime root keeps the accepted 15-source-pixel paw-bottom offset",
    }


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
    bg = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(np.clip(frame[..., :3] * alpha + bg * (1 - alpha), 0, 255).astype(np.uint8))


def gif_durations(count: int, total_ms: int) -> list[int]:
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / count / 10) for index in range(count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF timing: {values}")
    return values


def write_previews(cells: list[np.ndarray]) -> tuple[Path, Path, list[int]]:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    timing = gif_durations(len(cells), SOURCE_DURATION_MS)
    frames = [checker(cell) for cell in cells]
    gif = PREVIEW_DIR / "black-wolf-death.gif"
    frames[0].save(gif, save_all=True, append_images=frames[1:], duration=timing,
                   disposal=2, optimize=False)
    height, width = cells[0].shape[:2]
    tw, th = max(1, width // 2), max(1, height // 2)
    cols, label_h = 5, 22
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * tw, rows * (th + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, cell in enumerate(cells):
        x, y = (index % cols) * tw, (index // cols) * (th + label_h)
        contact.paste(checker(cell).resize((tw, th), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 4, y + th + 3), f"f{index} {'key' if index % 2 == 0 else 'RIFE'}", fill="white")
    contact_path = PREVIEW_DIR / "black-wolf-death-contact.png"
    contact.save(contact_path)
    return gif, contact_path, timing


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    return {
        "emptyFrames": [],
        "touchingFrames": [i for i, (x0, y0, x1, y1) in enumerate(boxes)
                           if x0 <= 2 or y0 <= 2 or x1 >= cells[i].shape[1] - 3
                           or y1 >= cells[i].shape[0] - 3],
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells),
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "alphaLeftMin": min(box[0] for box in boxes),
        "alphaRightMax": max(box[2] for box in boxes),
    }


def main() -> None:
    if not RIFE_EXE.exists():
        raise RuntimeError(f"Missing RIFE executable: {RIFE_EXE}")
    for directory in (SOURCE_DIR, FINAL_DIR, REPORT_DIR, PREVIEW_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    frames, source_fps = decode(VIDEO)
    model = get_model()
    source_cells, alignment = build_cells(frames, model)
    width, height = alignment["frameWidth"], alignment["frameHeight"]
    Image.fromarray(compose(source_cells, SOURCE_COLS), "RGBA").save(
        SOURCE_SHEET, optimize=True, compress_level=9)
    source_rate = len(source_cells) * 1000 / SOURCE_DURATION_MS
    command = [
        sys.executable, str(RIFE_TOOL), "--sheet", str(SOURCE_SHEET),
        "--out", str(FINAL_SHEET), "--name", "black-wolf-death",
        "--frame-width", str(width), "--frame-height", str(height),
        "--cols", str(SOURCE_COLS), "--frame-count", str(len(source_cells)),
        "--frame-rate", str(source_rate), "--mode", "one-shot",
        "--out-cols", str(FINAL_COLS), "--preview-dir", str(PREVIEW_DIR / "rife-tool"),
        "--report", str(RIFE_REPORT), "--rife", str(RIFE_EXE),
    ]
    subprocess.run(command, check=True)
    rife = json.loads(RIFE_REPORT.read_text(encoding="utf-8"))
    final_count = int(rife["outputFrameCount"])
    final_cells = extract_cells(FINAL_SHEET, width, height, final_count, FINAL_COLS)
    key_preserved = all(np.array_equal(source, final_cells[index * 2])
                        for index, source in enumerate(source_cells))
    for cell in final_cells:
        cell[cell[..., 3] == 0, :3] = 0
    Image.fromarray(compose(final_cells, FINAL_COLS), "RGBA").save(
        FINAL_SHEET, optimize=True, compress_level=9)
    gif, contact, timing = write_previews(final_cells)
    validation = validate(final_cells)
    validation["originalKeyFramesPreservedAtEvenIndices"] = key_preserved
    validation["interpolationPasses"] = 1
    validation["scaleAudit"] = "fixed scale for every source key; RIFE adds temporal in-betweens only"

    with Image.open(FINAL_SHEET) as atlas:
        atlas_width, atlas_height = atlas.size
    decoded_bytes = atlas_width * atlas_height * 4
    manifest = {
        "asset": "black-wolf",
        "action": "death",
        "stage": "formal-runtime-ready",
        "budgetTier": "crowd",
        "runtimeIntegrationActive": True,
        "facing": "screen-right",
        "sourceVideo": VIDEO.relative_to(ROOT).as_posix(),
        "sourceVideoFps": source_fps,
        "sourceWindow": [0, 64],
        "sourceWindowSemantics": "inclusive f0..f64; one complete collapse and settled corpse",
        "selectedSourceFrames": SOURCE_FRAMES,
        "settledFromSourceFrame": 56,
        "sourceWallClockMs": SOURCE_DURATION_MS,
        "sourceSheet": SOURCE_SHEET.relative_to(ROOT).as_posix(),
        "finalSheet": FINAL_SHEET.relative_to(ROOT).as_posix(),
        "runtimeAsset": RUNTIME_ASSET.relative_to(REPO).as_posix(),
        "previewGif": gif.relative_to(ROOT).as_posix(),
        "contactSheet": contact.relative_to(ROOT).as_posix(),
        "rifeReport": RIFE_REPORT.relative_to(ROOT).as_posix(),
        "frameWidth": width,
        "frameHeight": height,
        "atlasWidth": atlas_width,
        "atlasHeight": atlas_height,
        "columns": FINAL_COLS,
        "rows": math.ceil(final_count / FINAL_COLS),
        "frameCount": final_count,
        "endFrame": final_count - 1,
        "frameRate": final_count * 1000 / SOURCE_DURATION_MS,
        "durationMs": SOURCE_DURATION_MS,
        "repeat": 0,
        "footX": alignment["footX"],
        "footY": alignment["footY"],
        "referenceCell": 512,
        "decodedRgbaBytes": decoded_bytes,
        "decodedRgbaMiB": round(decoded_bytes / 1024 / 1024, 4),
        "pngBytes": FINAL_SHEET.stat().st_size,
        "gifTimingMs": timing,
        "alignment": alignment,
        "validation": validation,
    }
    (ROOT / "sprite-sheet-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    budget = {
        "asset": "black-wolf-death",
        "budgetTier": "crowd",
        "decodedRgbaMiB": manifest["decodedRgbaMiB"],
        "budgetTargetMiB": 32,
        "budgetHardStopMiB": 64,
        "withinTarget": decoded_bytes <= 32 * 1024 * 1024,
        "withinHardStop": decoded_bytes <= 64 * 1024 * 1024,
        "interpolationPasses": 1,
    }
    (ROOT / "sprite-budget-manifest.json").write_text(
        json.dumps(budget, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(FINAL_SHEET, RUNTIME_ASSET)
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
