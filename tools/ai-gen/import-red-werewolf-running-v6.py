#!/usr/bin/env python3
"""Import the approved stabilized RedWolfKing run video as the runtime sheet."""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
import sys

import av
import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))
from transparent_cutout import build_alpha, decontaminate, detect_bg_color  # noqa: E402


VIDEO = ROOT / "assets/videos/red_wolf_king_werewolf_running_white_h3_v6_final.mp4"
ASSET = ROOT / "assets/enemies/red_wolf_king/werewolf_running.png"
PREVIEW = ROOT / "tools/ai-gen/red-werewolf-previews/red-werewolf-running.gif"
WORK_DIR = ROOT / "tools/ai-gen/_scratch/red-werewolf-run-import-v6-20260823"
BACKUP = WORK_DIR / "werewolf_running_before_v6_import.png"
CANDIDATE = WORK_DIR / "werewolf_running_v6_candidate.png"
REPORT = WORK_DIR / "import-report.json"

SOURCE_PHASE_PAIR = [0, 48]
SOURCE_FRAMES = list(range(0, 48, 4))
CELL = 640
COLS = 8
ROWS = 6
FRAME_COUNT = 12
FOOT_Y = 606
CENTER_X = 320
REFERENCE_HEIGHT = 327
ALPHA_THRESHOLD = 12
PREVIEW_MS = 115


def decode(path: Path) -> list[np.ndarray]:
    with av.open(str(path)) as container:
        return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def cutout(rgb: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    bg = detect_bg_color(rgb)
    alpha = build_alpha(rgb, bg, tol=55, soft=38, feather=0.65, keep_largest=True)
    foreground = decontaminate(rgb, alpha, bg)
    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack((foreground, alpha_u8))
    rgba[alpha_u8 == 0, :3] = 0
    ys, xs = np.where(alpha_u8 > ALPHA_THRESHOLD)
    if not len(xs):
        raise RuntimeError("selected frame contains no foreground")
    return rgba, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def torso_anchor(rgba: np.ndarray, box: tuple[int, int, int, int]) -> tuple[float, float]:
    x0, y0, x1, y1 = box
    alpha = rgba[:, :, 3].astype(np.float64)
    body_w = x1 - x0
    body_h = y1 - y0
    tx0 = max(x0, round((x0 + x1) / 2 - body_w * 0.20))
    tx1 = min(x1, round((x0 + x1) / 2 + body_w * 0.20))
    ty1 = min(y1, y0 + round(body_h * 0.68))
    band = alpha[y0:ty1, tx0:tx1]
    ys, xs = np.where(band > ALPHA_THRESHOLD)
    if not len(xs):
        raise RuntimeError("selected frame contains no torso anchor")
    weights = band[ys, xs]
    return (
        float(np.average(xs + tx0, weights=weights)),
        float(np.average(ys + y0, weights=weights)),
    )


def remove_cyan_spill(rgba: np.ndarray) -> np.ndarray:
    output = rgba.copy()
    rgb = output[:, :, :3].astype(np.int16)
    alpha = output[:, :, 3]
    cyan = (
        (alpha > 4)
        & (rgb[:, :, 1] > rgb[:, :, 0] + 20)
        & (rgb[:, :, 2] > rgb[:, :, 0] + 20)
    )
    valid = (alpha > 8) & ~cyan
    if cyan.any() and valid.any():
        _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
        output[cyan, :3] = output[nearest[0][cyan], nearest[1][cyan], :3]
        output[cyan & (alpha < 24)] = 0
    output[output[:, :, 3] == 0, :3] = 0
    return output


def place_frames(cutouts: list[tuple[np.ndarray, tuple[int, int, int, int]]]) -> tuple[list[Image.Image], list[dict]]:
    first_box = cutouts[0][1]
    scale = REFERENCE_HEIGHT / (first_box[3] - first_box[1])
    anchors = [torso_anchor(rgba, box) for rgba, box in cutouts]
    relative_bottoms = [
        (box[3] - 1 - anchor[1]) * scale
        for (_, box), anchor in zip(cutouts, anchors, strict=True)
    ]
    target_torso_y = FOOT_Y - max(relative_bottoms)

    cells: list[Image.Image] = []
    placements: list[dict] = []
    for source_index, ((rgba, box), anchor) in enumerate(zip(cutouts, anchors, strict=True)):
        x0, y0, x1, y1 = box
        crop = Image.fromarray(rgba, "RGBA").crop(box)
        width = max(1, round(crop.width * scale))
        height = max(1, round(crop.height * scale))
        resized = crop.resize((width, height), Image.Resampling.LANCZOS)
        ox = round(CENTER_X - (anchor[0] - x0) * scale)
        oy = round(target_torso_y - (anchor[1] - y0) * scale)
        if ox < 4 or oy < 4 or ox + width > CELL - 4 or oy + height > CELL - 4:
            raise RuntimeError(f"frame {source_index} does not fit: {width}x{height} at {ox},{oy}")
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.alpha_composite(resized, (ox, oy))
        arr = remove_cyan_spill(np.asarray(cell))
        arr[arr[:, :, 3] == 0, :3] = 0
        cell = Image.fromarray(arr, "RGBA")
        cells.append(cell)

        alpha = arr[:, :, 3]
        ys, xs = np.where(alpha > ALPHA_THRESHOLD)
        placed_torso_y = oy + (anchor[1] - y0) * scale
        placements.append({
            "cell": source_index,
            "sourceFrame": SOURCE_FRAMES[source_index],
            "sourceBox": list(box),
            "placedBox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            "torsoY": round(float(placed_torso_y), 4),
            "alphaBottom": int(ys.max()),
        })
    return cells, placements


def build_sheet(cells: list[Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((index % COLS) * CELL, (index // COLS) * CELL))
    return sheet


def save_preview(cells: list[Image.Image]) -> None:
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    frames = []
    backdrop = Image.new("RGB", (CELL, CELL), (34, 42, 48))
    for cell in cells:
        frame = backdrop.copy()
        frame.paste(cell, mask=cell.getchannel("A"))
        frames.append(frame.resize((320, 320), Image.Resampling.LANCZOS))
    frames[0].save(
        PREVIEW, save_all=True, append_images=frames[1:],
        duration=PREVIEW_MS, loop=0, disposal=2,
    )


def main() -> None:
    frames = decode(VIDEO)
    if len(frames) != 124:
        raise RuntimeError(f"expected 124 source frames, got {len(frames)}")
    cutouts = [cutout(frames[index]) for index in SOURCE_FRAMES]
    cells, placements = place_frames(cutouts)
    sheet = build_sheet(cells)

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        shutil.copy2(ASSET, BACKUP)
    sheet.save(CANDIDATE, compress_level=6)

    alpha = np.asarray(sheet.getchannel("A"))
    nonempty = []
    touching = []
    for index in range(COLS * ROWS):
        row, col = divmod(index, COLS)
        cell_alpha = alpha[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL]
        if (cell_alpha > ALPHA_THRESHOLD).any():
            nonempty.append(index)
            edge = np.concatenate((
                cell_alpha[:4].ravel(), cell_alpha[-4:].ravel(),
                cell_alpha[:, :4].ravel(), cell_alpha[:, -4:].ravel(),
            ))
            if (edge > ALPHA_THRESHOLD).any():
                touching.append(index)
    if nonempty != list(range(FRAME_COUNT)) or touching:
        raise RuntimeError(f"asset validation failed: nonempty={nonempty}, touching={touching}")

    shutil.copy2(CANDIDATE, ASSET)
    save_preview(cells)
    torso_values = [item["torsoY"] for item in placements]
    bottoms = [item["alphaBottom"] for item in placements]
    rgba = np.asarray(sheet)
    report = {
        "sourceVideo": VIDEO.relative_to(ROOT).as_posix(),
        "sourceFrameCount": len(frames),
        "sourcePhasePair": SOURCE_PHASE_PAIR,
        "sampleIndexes": SOURCE_FRAMES,
        "runtimeAsset": ASSET.relative_to(ROOT).as_posix(),
        "backup": BACKUP.relative_to(ROOT).as_posix(),
        "preview": PREVIEW.relative_to(ROOT).as_posix(),
        "layout": {"cols": COLS, "rows": ROWS, "frames": FRAME_COUNT,
                   "frameWidth": CELL, "frameHeight": CELL, "footY": FOOT_Y},
        "referenceHeight": REFERENCE_HEIGHT,
        "torsoYRangePx": round(max(torso_values) - min(torso_values), 4),
        "alphaBottomRange": [min(bottoms), max(bottoms)],
        "nonemptyCells": nonempty,
        "touchingCells": touching,
        "transparentNonzeroRgb": int(((rgba[:, :, 3] == 0) & (rgba[:, :, :3].max(axis=2) > 0)).sum()),
        "placements": placements,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
