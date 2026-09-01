#!/usr/bin/env python3
"""Trim the approved lynx run keys and build the formal 2x RIFE loop."""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOLS = ROOT.parent

SOURCE_SQUARE = ROOT / "spritesheets" / "source-square" / "running.png"
SOURCE_SQUARE_REPORT = ROOT / "spritesheets" / "source-square" / "running_report.json"
SOURCE_DIR = ROOT / "spritesheets" / "source-pre-rife"
SOURCE_SHEET = SOURCE_DIR / "running.png"
SOURCE_REPORT = ROOT / "reports" / "sprites" / "source-pre-rife" / "running.json"
FINAL_DIR = ROOT / "spritesheets" / "final"
FINAL_SHEET = FINAL_DIR / "running.png"
FINAL_REPORT = ROOT / "reports" / "sprites" / "final" / "running-rife.json"
PREVIEW_DIR = ROOT / "previews" / "sprites" / "final" / "running"
SPRITE_MANIFEST = ROOT / "sprite-sheet-manifest.json"

RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

SOURCE_CELL = 576
FRAME_WIDTH = 576
FRAME_HEIGHT = 384
FIXED_CROP_Y = 128
SOURCE_COLS = 5
SOURCE_FRAME_COUNT = 15
SOURCE_FRAME_RATE = 12.0
FINAL_COLS = 6
FOOT_Y = 345
REFERENCE_CELL = 576
TARGET_HEIGHT = 262


def extract_cells(path: Path) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA")).copy()
    cells: list[np.ndarray] = []
    for index in range(SOURCE_FRAME_COUNT):
        row, col = divmod(index, SOURCE_COLS)
        cell = sheet[
            row * SOURCE_CELL:(row + 1) * SOURCE_CELL,
            col * SOURCE_CELL:(col + 1) * SOURCE_CELL,
        ].copy()
        cells.append(cell)
    return cells


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def fixed_trim(cells: list[np.ndarray]) -> tuple[list[np.ndarray], dict[str, object]]:
    trimmed: list[np.ndarray] = []
    bboxes: list[list[int]] = []
    for index, cell in enumerate(cells):
        out = cell[FIXED_CROP_Y:FIXED_CROP_Y + FRAME_HEIGHT, :FRAME_WIDTH].copy()
        out[out[..., 3] == 0, :3] = 0
        box = alpha_bbox(out)
        if box is None:
            raise RuntimeError(f"fixed crop made frame {index} empty")
        if box[0] <= 2 or box[1] <= 2 or box[2] >= FRAME_WIDTH - 3 or box[3] >= FRAME_HEIGHT - 3:
            raise RuntimeError(f"fixed crop touches frame edge at {index}: {box}")
        trimmed.append(out)
        bboxes.append(list(box))
    return trimmed, {
        "fixedCrop": [0, FIXED_CROP_Y, FRAME_WIDTH, FIXED_CROP_Y + FRAME_HEIGHT],
        "alphaBBoxes": bboxes,
        "emptyFrames": [],
        "touchingFrames": [],
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in trimmed
        ),
        "alphaBottomMin": min(box[3] for box in bboxes),
        "alphaBottomMax": max(box[3] for box in bboxes),
    }


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * FRAME_HEIGHT, cols * FRAME_WIDTH, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[
            row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
            col * FRAME_WIDTH:(col + 1) * FRAME_WIDTH,
        ] = cell
    return sheet


def distributed_gif_durations(frame_count: int, total_ms: int) -> list[int]:
    ticks = [round(i * total_ms / frame_count / 10) for i in range(frame_count + 1)]
    durations = [(ticks[i + 1] - ticks[i]) * 10 for i in range(frame_count)]
    if any(value <= 0 for value in durations) or sum(durations) != total_ms:
        raise RuntimeError(f"invalid GIF timing: {durations} total={sum(durations)}")
    return durations


def extract_final_cells(path: Path, frame_count: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA")).copy()
    cells: list[np.ndarray] = []
    for index in range(frame_count):
        row, col = divmod(index, FINAL_COLS)
        cells.append(
            sheet[
                row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
                col * FRAME_WIDTH:(col + 1) * FRAME_WIDTH,
            ].copy()
        )
    return cells


def repair_odd_red_chroma(cells: list[np.ndarray]) -> list[int]:
    """Remove RIFE-only red/brown blocks while leaving every source key untouched."""
    repaired: list[int] = []
    for index, frame in enumerate(cells):
        if index % 2 == 0:
            repaired.append(0)
            continue
        rgb = frame[..., :3].astype(np.int16)
        alpha = frame[..., 3]
        red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        seed = (
            (alpha > 64)
            & (red > green + 45)
            & (red > blue + 45)
        )
        expanded = ndimage.binary_dilation(seed, iterations=2)
        repair = (
            expanded
            & (alpha > 16)
            & (red > green + 15)
            & (red > blue + 15)
        )
        count = int(repair.sum())
        if count:
            valid = (alpha > 8) & ~expanded
            if not valid.any():
                raise RuntimeError(f"red chroma repair has no valid pixels in frame {index}")
            _, indices = ndimage.distance_transform_edt(~valid, return_indices=True)
            ys, xs = np.where(repair)
            frame[ys, xs, :3] = frame[indices[0, ys, xs], indices[1, ys, xs], :3]
        frame[alpha == 0, :3] = 0
        repaired.append(count)
    return repaired


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    rgb = frame[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def write_final_previews(cells: list[np.ndarray], total_ms: int) -> list[int]:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    durations = distributed_gif_durations(len(cells), total_ms)
    gif_frames = [
        checker(frame).resize((384, 256), Image.Resampling.LANCZOS)
        for frame in cells
    ]
    gif_path = PREVIEW_DIR / "snow-mane-lynx-running-interpolated.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )

    thumb_width, thumb_height, label_height, cols = 160, 107, 22, 8
    rows = math.ceil(len(cells) / cols)
    contact = Image.new(
        "RGB", (cols * thumb_width, rows * (thumb_height + label_height)), "#20242a"
    )
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(cells):
        preview = checker(frame).resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = (index % cols) * thumb_width
        y = (index // cols) * (thumb_height + label_height)
        contact.paste(preview, (x, y))
        kind = "key" if index % 2 == 0 else "RIFE"
        draw.text((x + 4, y + thumb_height + 3), f"f{index} {kind}", fill="white")
    contact.save(PREVIEW_DIR / "snow-mane-lynx-running-interpolated-contact.png")
    return durations


def main() -> None:
    if not SOURCE_SQUARE.exists() or not SOURCE_SQUARE_REPORT.exists():
        raise SystemExit("missing BiRefNet source-square outputs")
    if not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")

    source_square_report = json.loads(SOURCE_SQUARE_REPORT.read_text(encoding="utf-8"))
    cells, trim_validation = fixed_trim(extract_cells(SOURCE_SQUARE))
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE_REPORT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(compose(cells, SOURCE_COLS), "RGBA").save(
        SOURCE_SHEET, optimize=True, compress_level=9
    )
    source_report = {
        "sourceVideo": source_square_report["source"].replace("\\", "/"),
        "sourceVideoFrameRate": source_square_report["fps"],
        "sourceVideoFrameCount": source_square_report["sourceFrames"],
        "cycleStart": source_square_report["cycleStart"],
        "duplicateEndpoint": source_square_report["duplicateEndpoint"],
        "selectedSourceFrames": source_square_report["includedSourceFrames"],
        "frameCount": SOURCE_FRAME_COUNT,
        "frameRate": SOURCE_FRAME_RATE,
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "columns": SOURCE_COLS,
        "rows": math.ceil(SOURCE_FRAME_COUNT / SOURCE_COLS),
        "fixedScale": source_square_report["fixedScale"],
        "targetHeight": TARGET_HEIGHT,
        "horizontalAnchor": source_square_report["horizontalAnchor"],
        "footY": FOOT_Y,
        "referenceCell": REFERENCE_CELL,
        "normalization": "BiRefNet-general largest subject; one fixed scale; torso-root horizontal lock; one action-wide fixed crop",
        "cycleValidation": source_square_report["validation"],
        "trimValidation": trim_validation,
        "output": str(SOURCE_SHEET.relative_to(ROOT)).replace("\\", "/"),
    }
    SOURCE_REPORT.write_text(json.dumps(source_report, ensure_ascii=False, indent=2), encoding="utf-8")

    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    FINAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        str(RIFE_TOOL),
        "--sheet", str(SOURCE_SHEET),
        "--out", str(FINAL_SHEET),
        "--name", "snow-mane-lynx-running",
        "--frame-width", str(FRAME_WIDTH),
        "--frame-height", str(FRAME_HEIGHT),
        "--cols", str(SOURCE_COLS),
        "--frame-count", str(SOURCE_FRAME_COUNT),
        "--frame-rate", str(SOURCE_FRAME_RATE),
        "--mode", "loop",
        "--out-cols", str(FINAL_COLS),
        "--preview-dir", str(PREVIEW_DIR),
        "--report", str(FINAL_REPORT),
        "--rife", str(RIFE_EXE),
        "--repair-red-outliers",
    ]
    subprocess.run(command, check=True)

    final_report = json.loads(FINAL_REPORT.read_text(encoding="utf-8"))
    final_frame_count = int(final_report["outputFrameCount"])
    final_cells = extract_final_cells(FINAL_SHEET, final_frame_count)
    odd_red_repairs = repair_odd_red_chroma(final_cells)
    Image.fromarray(compose(final_cells, FINAL_COLS), "RGBA").save(
        FINAL_SHEET, optimize=True, compress_level=9
    )
    total_ms = round(SOURCE_FRAME_COUNT * 1000 / SOURCE_FRAME_RATE)
    preview_gif = PREVIEW_DIR / "snow-mane-lynx-running-interpolated.gif"
    gif_durations = write_final_previews(final_cells, total_ms)
    even_keys_preserved = all(
        np.array_equal(source, final_cells[index * 2])
        for index, source in enumerate(cells)
    )
    remaining_high_red = [
        int((
            (frame[..., 3] > 64)
            & (frame[..., 0].astype(np.int16) > frame[..., 1].astype(np.int16) + 45)
            & (frame[..., 0].astype(np.int16) > frame[..., 2].astype(np.int16) + 45)
        ).sum())
        if index % 2 else 0
        for index, frame in enumerate(final_cells)
    ]
    final_report["assetSpecificOddFrameRedChromaPixelsRepaired"] = odd_red_repairs
    final_report["assetSpecificOddFrameHighRedPixelsRemaining"] = remaining_high_red
    final_report["validation"]["originalKeyFramesPreservedAtEvenIndices"] = even_keys_preserved
    final_report["validation"]["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0]))
        for frame in final_cells
    )
    FINAL_REPORT.write_text(json.dumps(final_report, ensure_ascii=False, indent=2), encoding="utf-8")
    rgba_bytes = FRAME_WIDTH * FRAME_HEIGHT * final_frame_count * 4
    actual_sheet_bytes = FINAL_SHEET.stat().st_size
    manifest = {
        "asset": "snow-mane-lynx",
        "stage": "formal-running-sprite-candidate",
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "budgetTier": "crowd",
        "pipeline": "approved MiniMax H3 source -> BiRefNet-general -> fixed scale/root and action-wide crop -> RIFE v4.6 RGBA 2x",
        "actions": {
            "running": {
                "sourceVideo": "videos/snow-mane-lynx-running-h3-v01.mp4",
                "sourceSheet": str(SOURCE_SHEET.relative_to(ROOT)).replace("\\", "/"),
                "finalSheet": str(FINAL_SHEET.relative_to(ROOT)).replace("\\", "/"),
                "previewGif": str(preview_gif.relative_to(ROOT)).replace("\\", "/"),
                "contactSheet": str((PREVIEW_DIR / "snow-mane-lynx-running-interpolated-contact.png").relative_to(ROOT)).replace("\\", "/"),
                "sourceReport": str(SOURCE_REPORT.relative_to(ROOT)).replace("\\", "/"),
                "rifeReport": str(FINAL_REPORT.relative_to(ROOT)).replace("\\", "/"),
                "frameWidth": FRAME_WIDTH,
                "frameHeight": FRAME_HEIGHT,
                "columns": FINAL_COLS,
                "rows": math.ceil(final_frame_count / FINAL_COLS),
                "frameCount": final_frame_count,
                "endFrame": final_frame_count - 1,
                "frameRate": final_report["outputFrameRate"],
                "durationMs": total_ms,
                "repeat": -1,
                "facing": "screen-right",
                "footX": FRAME_WIDTH // 2,
                "footY": FOOT_Y,
                "referenceCell": REFERENCE_CELL,
                "decodedRgbaBytes": rgba_bytes,
                "decodedRgbaMiB": round(rgba_bytes / 1024 / 1024, 4),
                "pngBytes": actual_sheet_bytes,
                "gifTimingMs": gif_durations,
                "validation": final_report["validation"],
            }
        },
    }
    SPRITE_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
