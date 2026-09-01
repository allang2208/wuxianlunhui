#!/usr/bin/env python3
"""Build the four compact, fixed-scale Snow-Mane Lynx sheets and RIFE previews."""

from __future__ import annotations

import json
import math
import runpy
import subprocess
import sys
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOLS = ROOT.parent
COMMON = runpy.run_path(str(TOOLS / "character-run-video-rebuild.py"))
decode = COMMON["decode"]
cutout = COMMON["cutout"]
bbox = COMMON["bbox"]
torso_anchor = COMMON["torso_anchor"]
lower_body_anchor = COMMON["lower_body_anchor"]
get_model = COMMON["get_model"]

RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (REPO.parent / "_tmp" / "elise_audit" / "rife"
            / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe")
RUN_SOURCE = ROOT / "spritesheets" / "source-pre-rife" / "running.png"
RUN_REPORT = ROOT / "reports" / "sprites" / "source-pre-rife" / "running.json"
SOURCE_DIR = ROOT / "spritesheets" / "formal-source-pre-rife"
FINAL_DIR = ROOT / "spritesheets" / "formal-final"
REPORT_DIR = ROOT / "reports" / "sprites" / "formal-final"
PREVIEW_ROOT = ROOT / "previews" / "sprites" / "formal-final"

FIXED_SCALE = 0.6405867970660146
HIGH_FOOT_Y = 345
HIGH_HEIGHT = 384
RUNTIME_TARGET_HEIGHT = 172
RUNTIME_HEIGHT = 240
RUNTIME_FOOT_Y = 216
RUNTIME_REFERENCE_CELL = 360
FINAL_COLS = 6

ACTIONS = {
    "idle": {
        "video": ROOT / "videos" / "snow-mane-lynx-idle-h3-v01.mp4",
        "sourceFrames": [0, 16, 32, 48, 64, 80, 96, 112],
        "sourceWidth": 576,
        "anchorMode": "stabilized",
        "rifeMode": "loop",
        "finalCols": 4,
        "durationMs": 5170,
        "repeat": -1,
    },
    "running": {
        "existingSource": RUN_SOURCE,
        "existingReport": RUN_REPORT,
        "rifeMode": "loop",
        "finalCols": 6,
        "durationMs": 1250,
        "repeat": -1,
    },
    "attack": {
        "video": ROOT / "videos" / "snow-mane-lynx-attacking-h3-v01.mp4",
        # The H3 recover clip contains three separate paw swipes plus long idle
        # holds. Keep only the first complete action at its native 24 fps wall
        # clock: f18..f42 sampled uniformly every three source frames. RIFE then
        # inserts exactly one midpoint between each pair (9 keys -> 17 frames).
        # The denser source keys also keep the paw/face displacement small enough
        # to avoid the structural tear seen between the former f34/f38 pair.
        "sourceFrames": [18, 21, 24, 27, 30, 33, 36, 39, 42],
        # The attack-only H3 safety frame deliberately made the lynx about 75.5%
        # of the neutral-frame body length. Restore identity scale once per action;
        # do not stretch individual frames or sacrifice the source-video safety box.
        "sourceWidth": 1024,
        "sourceScale": FIXED_SCALE * (278 / 210),
        "anchorMode": "source",
        "rifeMode": "one-shot",
        "finalCols": 1,
        "runtimeHeight": 224,
        "runtimeFootY": 208,
        "durationMs": 1000,
        "repeat": 0,
        "contactFrame": 10,
        "activeFrames": [9, 11],
        "sourceWindow": [18, 42],
        "sourceVideoFps": 24,
        "sourceWallClockMs": 1000,
        "excludedRepeatedStrikeRanges": [[43, 53], [62, 70]],
        # Preserve the strike and contact poses, then return the visual root to
        # the neutral anchor during recovery. Whole-cell integer translations
        # avoid any per-axis scaling or deformation.
        "frameTranslationsX": {12: -11, 13: -22, 14: -35, 15: -50, 16: -65},
        # RIFE stays clean at the slow bookends but invents paw/mouth chroma in
        # the fast strike. Replace those generated odd frames with the nearest
        # native H3 source pose at the same half-step time. These are unique
        # poses, not held/duplicated neighbouring keys.
        "nativeOddSourceFallbacks": {5: 26, 7: 29, 9: 32, 11: 35, 13: 38},
    },
    "death": {
        "video": ROOT / "videos" / "snow-mane-lynx-dying-h3-v01.mp4",
        "sourceFrames": [0, 16, 24, 32, 37, 42, 48, 70, 101],
        "sourceWidth": 640,
        "anchorMode": "source",
        "rifeMode": "one-shot",
        "finalCols": 6,
        "durationMs": 1800,
        "repeat": 0,
        # f9 previously duplicated f10. Use the native half-step source pose,
        # then align the complete collapse to the neutral horizontal root.
        "nativeOddSourceFallbacks": {9: 40},
        "uniformTranslationX": -36,
    },
}


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def paste_checked(content: np.ndarray, x: int, y: int, width: int, height: int) -> np.ndarray:
    ch, cw = content.shape[:2]
    if x < 3 or y < 3 or x + cw > width - 3 or y + ch > height - 3:
        raise RuntimeError(f"content clips: {cw}x{ch} at ({x},{y}) in {width}x{height}")
    frame = np.zeros((height, width, 4), dtype=np.uint8)
    frame[y:y + ch, x:x + cw] = content
    return frame


def resize_cutout(rgba: np.ndarray, scale: float) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    x0, y0, x1, y1 = bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
    return np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS)), (x0, y0, x1, y1)


def make_high_cells(
    spec: dict, model, source_frames: list[int] | None = None
) -> list[np.ndarray]:
    frames, _fps = decode(spec["video"])
    selected = source_frames or spec["sourceFrames"]
    reference_index = spec["sourceFrames"][0]
    cutouts = {}
    for source_index in dict.fromkeys([reference_index, *selected]):
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[lynx-formal] BiRefNet {spec['video'].stem} f{source_index}", flush=True)
    reference = cutouts[reference_index]
    _rx0, _ry0, _rx1, ry1 = bbox(reference)
    reference_anchor = lower_body_anchor(reference)
    cells = []
    for source_index in selected:
        rgba = cutouts[source_index]
        source_scale = spec.get("sourceScale", FIXED_SCALE)
        resized, (x0, y0, _x1, y1) = resize_cutout(rgba, source_scale)
        if spec["anchorMode"] == "stabilized":
            x = round(spec["sourceWidth"] / 2 - (torso_anchor(rgba) - x0) * source_scale)
            y = HIGH_FOOT_Y - resized.shape[0]
        else:
            x = round(spec["sourceWidth"] / 2 + (x0 - reference_anchor) * source_scale)
            y = round(HIGH_FOOT_Y + (y0 - ry1) * source_scale)
        cell = paste_checked(resized, x, y, spec["sourceWidth"], HIGH_HEIGHT)
        cell[cell[..., 3] == 0, :3] = 0
        cells.append(cell)
    return cells


def extract_cells(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [sheet[(index // cols) * height:(index // cols + 1) * height,
                  (index % cols) * width:(index % cols + 1) * width].copy()
            for index in range(count)]


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    height, width = cells[0].shape[:2]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * height, cols * width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def apply_frame_translations_x(cells: list[np.ndarray], spec: dict) -> dict[int, int]:
    """Apply structure-safe whole-frame X translations without clipping alpha."""
    per_frame = {int(index): int(dx) for index, dx in spec.get("frameTranslationsX", {}).items()}
    uniform = int(spec.get("uniformTranslationX", 0))
    applied = {}
    for index, cell in enumerate(cells):
        dx = per_frame.get(index, uniform)
        if dx == 0:
            continue
        height, width = cell.shape[:2]
        if abs(dx) >= width:
            raise RuntimeError(f"frame {index} translation {dx} exceeds width {width}")
        shifted = np.zeros_like(cell)
        if dx > 0:
            shifted[:, dx:] = cell[:, :width - dx]
        else:
            shifted[:, :width + dx] = cell[:, -dx:]
        if np.count_nonzero(shifted[..., 3]) != np.count_nonzero(cell[..., 3]):
            raise RuntimeError(f"frame {index} translation {dx} clips visible pixels")
        shifted[shifted[..., 3] == 0, :3] = 0
        cells[index] = shifted
        applied[index] = dx
    return applied


def round32(value: int) -> int:
    return max(320, math.ceil(value / 32) * 32)


def compact_cells(
    high_cells: list[np.ndarray],
    high_foot_y: int,
    runtime_height: int = RUNTIME_HEIGHT,
    runtime_foot_y: int = RUNTIME_FOOT_Y,
    forced_width: int | None = None,
) -> tuple[list[np.ndarray], int]:
    scale = RUNTIME_TARGET_HEIGHT / 262.0
    required_half = 0
    for cell in high_cells:
        x0, _y0, x1, _y1 = alpha_bbox(cell)
        required_half = max(required_half, abs(x0 - cell.shape[1] / 2), abs(x1 - cell.shape[1] / 2))
    width = forced_width or round32(round(required_half * scale * 2 + 24))
    compact = []
    for cell in high_cells:
        x0, y0, x1, y1 = alpha_bbox(cell)
        crop = cell[y0:y1 + 1, x0:x1 + 1]
        size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        x = round(width / 2 + (x0 - cell.shape[1] / 2) * scale)
        y = round(runtime_foot_y + (y0 - high_foot_y) * scale)
        out = paste_checked(resized, x, y, width, runtime_height)
        out[out[..., 3] == 0, :3] = 0
        compact.append(out)
    return compact, width


def repair_odd_red_chroma(cells: list[np.ndarray]) -> list[int]:
    repaired = []
    for index, frame in enumerate(cells):
        if index % 2 == 0:
            repaired.append(0)
            continue
        rgb = frame[..., :3].astype(np.int16)
        alpha = frame[..., 3]
        red_seed = ((alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 38)
                    & (rgb[..., 0] > rgb[..., 2] + 45))
        magenta_seed = ((alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 28)
                        & (rgb[..., 2] > rgb[..., 1] + 10)
                        & (rgb[..., 0] > 90))
        seed = red_seed | magenta_seed
        expanded = ndimage.binary_dilation(seed, iterations=2)
        red_mask = ((rgb[..., 0] > rgb[..., 1] + 15)
                    & (rgb[..., 0] > rgb[..., 2] + 15))
        magenta_mask = ((rgb[..., 0] > rgb[..., 1] + 12)
                        & (rgb[..., 2] > rgb[..., 1] + 8))
        mask = expanded & (alpha > 0) & (red_mask | magenta_mask)
        count = int(mask.sum())
        if count:
            valid = (alpha > 8) & ~expanded
            _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
            ys, xs = np.where(mask)
            frame[ys, xs, :3] = frame[nearest[0, ys, xs], nearest[1, ys, xs], :3]
        frame[alpha == 0, :3] = 0
        repaired.append(count)
    return repaired


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
    bg = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(np.clip(frame[..., :3] * alpha + bg * (1 - alpha), 0, 255).astype(np.uint8))


def durations(count: int, total_ms: int) -> list[int]:
    ticks = [round(index * total_ms / count / 10) for index in range(count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(count)]
    if min(values) <= 0 or sum(values) != total_ms:
        raise RuntimeError(f"invalid GIF durations: {values}")
    return values


def write_previews(action: str, cells: list[np.ndarray], total_ms: int) -> tuple[Path, Path, list[int]]:
    out_dir = PREVIEW_ROOT / action
    out_dir.mkdir(parents=True, exist_ok=True)
    timing = durations(len(cells), total_ms)
    # Preview pixels must keep the runtime cell aspect ratio.  The previous fixed
    # 384x240 target squeezed wide attack/death cells and stretched narrow idle
    # cells even though the source videos and runtime atlases were correct.
    height, width = cells[0].shape[:2]
    gifs = [checker(cell) for cell in cells]
    gif = out_dir / f"snow-mane-lynx-{action}.gif"
    gifs[0].save(gif, save_all=True, append_images=gifs[1:], duration=timing,
                 loop=0, disposal=2, optimize=False)
    tw, th, lh, cols = max(1, width // 2), max(1, height // 2), 22, 6
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * tw, rows * (th + lh)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, cell in enumerate(cells):
        x, y = (index % cols) * tw, (index // cols) * (th + lh)
        contact.paste(checker(cell).resize((tw, th), Image.Resampling.LANCZOS), (x, y))
        native_fallbacks = ACTIONS.get(action, {}).get("nativeOddSourceFallbacks", {})
        frame_kind = "native" if index in native_fallbacks else ("key" if index % 2 == 0 else "RIFE")
        draw.text((x + 4, y + th + 3), f"f{index} {frame_kind}", fill="white")
    contact_path = out_dir / f"snow-mane-lynx-{action}-contact.png"
    contact.save(contact_path)
    return gif, contact_path, timing


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    exact_duplicates = [
        [left, right]
        for left in range(len(cells))
        for right in range(left + 1, len(cells))
        if np.array_equal(cells[left], cells[right])
    ]
    return {
        "emptyFrames": [],
        "touchingFrames": [index for index, (x0, y0, x1, y1) in enumerate(boxes)
                           if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3
                           or y1 >= cells[index].shape[0] - 3],
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells),
        "exactDuplicateFramePairs": exact_duplicates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--actions",
        default="all",
        help="Comma-separated action names, or 'all'. Scoped rebuilds preserve other manifest entries.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    requested = list(ACTIONS) if args.actions == "all" else [part.strip() for part in args.actions.split(",") if part.strip()]
    unknown = [action for action in requested if action not in ACTIONS]
    if unknown:
        raise SystemExit(f"unknown actions: {unknown}")
    if not RIFE_EXE.exists() or not RUN_SOURCE.exists() or not RUN_REPORT.exists():
        raise SystemExit("missing RIFE executable or accepted running source")
    for directory in (SOURCE_DIR, FINAL_DIR, REPORT_DIR, PREVIEW_ROOT):
        directory.mkdir(parents=True, exist_ok=True)
    run_report = json.loads(RUN_REPORT.read_text(encoding="utf-8"))
    model = get_model() if any(action != "running" for action in requested) else None
    manifest_path = ROOT / "sprite-sheet-manifest.json"
    if requested == list(ACTIONS) or not manifest_path.exists():
        manifest = {
            "asset": "snow-mane-lynx",
            "stage": "formal-four-action-runtime-ready",
            "budgetTier": "crowd",
            "runtimeIntegrationActive": True,
            "facing": "screen-right",
            "fixedScale": FIXED_SCALE,
            "runtimeTargetHeight": RUNTIME_TARGET_HEIGHT,
            "referenceCell": RUNTIME_REFERENCE_CELL,
            "actions": {},
        }
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for action in requested:
        spec = ACTIONS[action]
        runtime_height = spec.get("runtimeHeight", RUNTIME_HEIGHT)
        runtime_foot_y = spec.get("runtimeFootY", RUNTIME_FOOT_Y)
        if action == "running":
            high_cells = extract_cells(RUN_SOURCE, run_report["frameWidth"], run_report["frameHeight"],
                                       run_report["frameCount"], run_report["columns"])
            selected = run_report["selectedSourceFrames"]
        else:
            high_cells = make_high_cells(spec, model)
            selected = spec["sourceFrames"]
        compact, width = compact_cells(high_cells, HIGH_FOOT_Y, runtime_height, runtime_foot_y)
        source_cols = min(5, len(compact))
        source_sheet = SOURCE_DIR / f"{action}.png"
        Image.fromarray(compose(compact, source_cols), "RGBA").save(source_sheet, optimize=True, compress_level=9)
        source_rate = len(compact) * 1000 / spec["durationMs"]
        final_sheet = FINAL_DIR / f"{action}.png"
        report_path = REPORT_DIR / f"{action}-rife.json"
        preview_dir = PREVIEW_ROOT / action / "rife-tool"
        command = [
            sys.executable, str(RIFE_TOOL), "--sheet", str(source_sheet), "--out", str(final_sheet),
            "--name", f"snow-mane-lynx-{action}", "--frame-width", str(width),
            "--frame-height", str(runtime_height), "--cols", str(source_cols),
            "--frame-count", str(len(compact)), "--frame-rate", str(source_rate),
            "--mode", spec["rifeMode"], "--out-cols", str(spec["finalCols"]),
            "--preview-dir", str(preview_dir), "--report", str(report_path),
            "--rife", str(RIFE_EXE), "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)
        rife_report = json.loads(report_path.read_text(encoding="utf-8"))
        final_count = int(rife_report["outputFrameCount"])
        final_cells = extract_cells(final_sheet, width, runtime_height, final_count, spec["finalCols"])
        red_repairs = repair_odd_red_chroma(final_cells)
        native_fallbacks = []
        fallback_spec = spec.get("nativeOddSourceFallbacks", {})
        if fallback_spec:
            fallback_sources = list(dict.fromkeys(fallback_spec.values()))
            fallback_high = make_high_cells(spec, model, fallback_sources)
            fallback_compact, fallback_width = compact_cells(
                fallback_high,
                HIGH_FOOT_Y,
                runtime_height,
                runtime_foot_y,
                forced_width=width,
            )
            if fallback_width != width:
                raise RuntimeError(f"fallback width {fallback_width} != final width {width}")
            by_source = dict(zip(fallback_sources, fallback_compact))
            for output_index, source_index in fallback_spec.items():
                if output_index % 2 == 0 or not (0 <= output_index < final_count):
                    raise RuntimeError(f"invalid native odd fallback output index: {output_index}")
                final_cells[output_index] = by_source[source_index].copy()
                native_fallbacks.append({
                    "outputFrame": output_index,
                    "sourceVideoFrame": source_index,
                    "reason": "native half-step replacement for fast-strike RIFE chroma/shape artifact",
                })
        key_frames_preserved = all(
            np.array_equal(source, final_cells[index * 2]) for index, source in enumerate(compact))
        frame_translations = apply_frame_translations_x(final_cells, spec)
        Image.fromarray(compose(final_cells, spec["finalCols"]), "RGBA").save(final_sheet, optimize=True, compress_level=9)
        gif, contact, gif_timing = write_previews(action, final_cells, spec["durationMs"])
        validation = validate(final_cells)
        validation["originalKeyFramesPreservedAtEvenIndicesBeforeWholeFrameTranslation"] = key_frames_preserved
        validation["oddFrameRedChromaPixelsRepaired"] = red_repairs
        validation["nativeSourceFrameFallbacks"] = native_fallbacks
        validation["wholeFrameTranslationsX"] = frame_translations
        validation["translationMode"] = "whole-frame integer pixels; no scale or warp"
        with Image.open(final_sheet) as atlas_image:
            atlas_width, atlas_height = atlas_image.size
        decoded = atlas_width * atlas_height * 4
        action_manifest = {
            "sourceVideo": str(spec.get("video", run_report["sourceVideo"])).replace("\\", "/"),
            "selectedSourceFrames": selected,
            "sourceSheet": str(source_sheet.relative_to(ROOT)).replace("\\", "/"),
            "finalSheet": str(final_sheet.relative_to(ROOT)).replace("\\", "/"),
            "previewGif": str(gif.relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str(contact.relative_to(ROOT)).replace("\\", "/"),
            "rifeReport": str(report_path.relative_to(ROOT)).replace("\\", "/"),
            "frameWidth": width,
            "frameHeight": runtime_height,
            "atlasWidth": atlas_width,
            "atlasHeight": atlas_height,
            "columns": spec["finalCols"],
            "rows": math.ceil(final_count / spec["finalCols"]),
            "frameCount": final_count,
            "endFrame": final_count - 1,
            "frameRate": final_count * 1000 / spec["durationMs"],
            "durationMs": spec["durationMs"],
            "repeat": spec["repeat"],
            "footX": width // 2,
            "footY": runtime_foot_y,
            "decodedRgbaBytes": decoded,
            "decodedRgbaMiB": round(decoded / 1024 / 1024, 4),
            "pngBytes": final_sheet.stat().st_size,
            "gifTimingMs": gif_timing,
            "validation": validation,
        }
        for field in ("contactFrame", "activeFrames"):
            if field in spec:
                action_manifest[field] = spec[field]
        for field in (
            "sourceWindow", "sourceVideoFps", "sourceWallClockMs",
            "excludedRepeatedStrikeRanges",
        ):
            if field in spec:
                action_manifest[field] = spec[field]
        manifest["actions"][action] = action_manifest
        print(f"[lynx-formal] built {action}: {width}x{runtime_height} x {final_count}", flush=True)
    # GPU residency follows the real atlas dimensions, including any unused
    # capacity cell in a rectangular PNG. Scoped rebuilds therefore refresh
    # every preserved action from its current final sheet before summing.
    for entry in manifest["actions"].values():
        sheet_path = ROOT / entry["finalSheet"]
        with Image.open(sheet_path) as atlas_image:
            atlas_width, atlas_height = atlas_image.size
        decoded = atlas_width * atlas_height * 4
        entry["atlasWidth"] = atlas_width
        entry["atlasHeight"] = atlas_height
        entry["decodedRgbaBytes"] = decoded
        entry["decodedRgbaMiB"] = round(decoded / 1024 / 1024, 4)
    total_rgba = sum(int(entry["decodedRgbaBytes"]) for entry in manifest["actions"].values())
    manifest["decodedRgbaBytes"] = total_rgba
    manifest["decodedRgbaMiB"] = round(total_rgba / 1024 / 1024, 4)
    manifest["budgetTargetMiB"] = 32
    manifest["budgetHardStopMiB"] = 64
    manifest["budgetWithinHardStop"] = total_rgba <= 64 * 1024 * 1024
    manifest["budgetWithinTarget"] = total_rgba <= 32 * 1024 * 1024
    manifest["actionScaleMultipliers"] = {
        action: ACTIONS[action].get("sourceScale", FIXED_SCALE) / FIXED_SCALE for action in ACTIONS
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
