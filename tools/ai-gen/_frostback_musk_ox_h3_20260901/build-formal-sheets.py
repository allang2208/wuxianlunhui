#!/usr/bin/env python3
"""Build compact Frostback Musk Ox RGBA sheets with one RIFE pass per action."""

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
SOURCE_DIR = ROOT / "spritesheets" / "formal-source-pre-rife"
FINAL_DIR = ROOT / "spritesheets" / "formal-final"
REPORT_DIR = ROOT / "reports" / "sprites" / "formal-final"
PREVIEW_ROOT = ROOT / "previews" / "sprites" / "formal-final"

HIGH_HEIGHT = 448
HIGH_FOOT_Y = 388
REFERENCE_BODY_HEIGHT = 262
RUNTIME_TARGET_HEIGHT = 156
RUNTIME_HEIGHT = 208
RUNTIME_FOOT_Y = 188

IDLE_REF = ROOT / "references" / "frostback-musk-ox-idle-keyframe-v01-1024x576.png"
RUN_REF = ROOT / "references" / "frostback-musk-ox-running-keyframe-v01-1024x576.png"
ATTACK_REF = ROOT / "references" / "frostback-musk-ox-attacking-keyframe-v01-1024x576.png"

ACTIONS = {
    "idle": {
        "video": ROOT / "videos" / "frostback-musk-ox-idle-h3-v01.mp4",
        "reference": IDLE_REF,
        "sourceFrames": [0, 16, 32, 48, 64, 80, 96, 112],
        "anchorMode": "stabilized",
        "rifeMode": "loop",
        "finalCols": 4,
        "durationMs": 5170,
        "repeat": -1,
        "sourceContract": "full H3 first/last-frame loop, evenly sampled without clock compression",
    },
    "running": {
        "video": ROOT / "videos" / "frostback-musk-ox-running-h3-v01.mp4",
        "reference": RUN_REF,
        # Analyzer + contact review: f26 and f60 are the same planted-hoof phase.
        # Keep [26,60), one 34-frame natural gait at native 24 fps. The 17 even
        # source keys plus the single RIFE pass restore 34 frames including seam.
        "sourceFrames": list(range(26, 60, 2)),
        "anchorMode": "stabilized",
        "rifeMode": "loop",
        "finalCols": 2,
        "durationMs": 1417,
        "repeat": -1,
        "sourceWindow": [26, 60],
        "sourceWindowSemantics": "[26,60), duplicate same-phase endpoint f60 excluded",
        "sourceVideoFps": 24,
        "sourceWallClockMs": 1416.667,
    },
    "attack": {
        "video": ROOT / "videos" / "frostback-musk-ox-attacking-h3-v01.mp4",
        "reference": ATTACK_REF,
        # Only the first complete headbutt at its original wall clock. The H3
        # source repeats the action from roughly f75; that entire range is excluded.
        "sourceFrames": list(range(10, 50, 3)),
        "anchorMode": "source",
        "rifeMode": "one-shot",
        "finalCols": 3,
        "durationMs": 1625,
        "repeat": 0,
        "contactFrame": 10,
        "activeFrames": [8, 12],
        "sourceWindow": [10, 49],
        "sourceVideoFps": 24,
        "sourceWallClockMs": 1625,
        "excludedRepeatedStrikeRanges": [[75, 101]],
    },
    "death": {
        "video": ROOT / "videos" / "frostback-musk-ox-dying-h3-v01.mp4",
        "reference": IDLE_REF,
        # Full first collapse plus a short settled endpoint; no recovery or replay.
        "sourceFrames": list(range(0, 52, 3)),
        "anchorMode": "source",
        "rifeMode": "one-shot",
        "finalCols": 5,
        "durationMs": 2125,
        "repeat": 0,
        "sourceWindow": [0, 51],
        "sourceVideoFps": 24,
        "sourceWallClockMs": 2125,
        "settledFromSourceFrame": 48,
    },
}


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def reference_bbox(path: Path) -> tuple[int, int, int, int]:
    image = np.asarray(Image.open(path).convert("RGB"))
    distance = np.linalg.norm(image.astype(np.float32) - 255.0, axis=2)
    mask = distance > 28.0
    count, labels, stats, _ = __import__("cv2").connectedComponentsWithStats(np.uint8(mask) * 255, 8)
    largest = 1 + int(np.argmax(stats[1:, __import__("cv2").CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
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


def make_high_cells(spec: dict, model, base_scale: float, action_multiplier: float) -> list[np.ndarray]:
    frames, _fps = decode(spec["video"])
    selected = spec["sourceFrames"]
    reference_index = selected[0]
    cutouts = {}
    for source_index in selected:
        cutouts[source_index] = cutout(frames[source_index], model)
        print(f"[musk-ox-formal] BiRefNet {spec['video'].stem} f{source_index}", flush=True)
    reference = cutouts[reference_index]
    _rx0, _ry0, _rx1, ry1 = bbox(reference)
    reference_anchor = lower_body_anchor(reference)
    scale = base_scale * action_multiplier
    cells = []
    for source_index in selected:
        rgba = cutouts[source_index]
        resized, (x0, y0, _x1, _y1) = resize_cutout(rgba, scale)
        if spec["anchorMode"] == "stabilized":
            x = round(1024 / 2 - (torso_anchor(rgba) - x0) * scale)
            y = HIGH_FOOT_Y - resized.shape[0]
        else:
            x = round(1024 / 2 + (x0 - reference_anchor) * scale)
            y = round(HIGH_FOOT_Y + (y0 - ry1) * scale)
        cell = paste_checked(resized, x, y, 1024, HIGH_HEIGHT)
        cell[cell[..., 3] == 0, :3] = 0
        cells.append(cell)
    return cells


def extract_cells(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [sheet[(i // cols) * height:(i // cols + 1) * height,
                  (i % cols) * width:(i % cols + 1) * width].copy() for i in range(count)]


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
    return max(256, math.ceil(value / 32) * 32)


def compact_cells(high_cells: list[np.ndarray]) -> tuple[list[np.ndarray], int]:
    scale = RUNTIME_TARGET_HEIGHT / REFERENCE_BODY_HEIGHT
    required_half = 0.0
    for cell in high_cells:
        x0, _y0, x1, _y1 = alpha_bbox(cell)
        required_half = max(required_half, abs(x0 - cell.shape[1] / 2), abs(x1 - cell.shape[1] / 2))
    width = round32(round(required_half * scale * 2 + 24))
    compact = []
    for cell in high_cells:
        x0, y0, x1, y1 = alpha_bbox(cell)
        crop = cell[y0:y1 + 1, x0:x1 + 1]
        size = (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale)))
        resized = np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS))
        x = round(width / 2 + (x0 - cell.shape[1] / 2) * scale)
        y = round(RUNTIME_FOOT_Y + (y0 - HIGH_FOOT_Y) * scale)
        out = paste_checked(resized, x, y, width, RUNTIME_HEIGHT)
        out[out[..., 3] == 0, :3] = 0
        compact.append(out)
    return compact, width


def repair_odd_chroma(cells: list[np.ndarray]) -> list[int]:
    repaired = []
    for index, frame in enumerate(cells):
        if index % 2 == 0:
            repaired.append(0)
            continue
        rgb = frame[..., :3].astype(np.int16)
        alpha = frame[..., 3]
        seed = ((alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 42)
                & (rgb[..., 0] > rgb[..., 2] + 42))
        expanded = ndimage.binary_dilation(seed, iterations=2)
        mask = expanded & (alpha > 0) & (rgb[..., 0] > rgb[..., 1] + 18)
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
    # GIF delays are stored in 10 ms ticks. Preserve the runtime/source clock in
    # the manifest and quantize only the human-review preview to the nearest tick.
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / count / 10) for index in range(count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF durations: {values}")
    return values


def write_previews(action: str, cells: list[np.ndarray], total_ms: int) -> tuple[Path, Path, list[int]]:
    out_dir = PREVIEW_ROOT / action
    out_dir.mkdir(parents=True, exist_ok=True)
    timing = durations(len(cells), total_ms)
    frames = [checker(cell) for cell in cells]
    gif = out_dir / f"frostback-musk-ox-{action}.gif"
    frames[0].save(gif, save_all=True, append_images=frames[1:], duration=timing,
                   loop=0, disposal=2, optimize=False)
    height, width = cells[0].shape[:2]
    tw, th, label_h, cols = max(1, width // 2), max(1, height // 2), 22, 6
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (cols * tw, rows * (th + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, cell in enumerate(cells):
        x, y = (index % cols) * tw, (index // cols) * (th + label_h)
        contact.paste(checker(cell).resize((tw, th), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 4, y + th + 3), f"f{index} {'key' if index % 2 == 0 else 'RIFE'}", fill="white")
    contact_path = out_dir / f"frostback-musk-ox-{action}-contact.png"
    contact.save(contact_path)
    return gif, contact_path, timing


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    duplicates = [[left, right] for left in range(len(cells)) for right in range(left + 1, len(cells))
                  if np.array_equal(cells[left], cells[right])]
    return {
        "emptyFrames": [],
        "touchingFrames": [i for i, (x0, y0, x1, y1) in enumerate(boxes)
                           if x0 <= 2 or y0 <= 2 or x1 >= cells[i].shape[1] - 3
                           or y1 >= cells[i].shape[0] - 3],
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0]))
                                               for cell in cells),
        "exactDuplicateFramePairs": duplicates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--postprocess-existing",
        default="",
        help="Comma-separated existing formal actions to align without rerunning cutout or RIFE.",
    )
    return parser.parse_args()


def postprocess_existing(actions: list[str]) -> None:
    manifest_path = ROOT / "sprite-sheet-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for action in actions:
        if action not in ACTIONS or action not in manifest["actions"]:
            raise RuntimeError(f"unknown existing action: {action}")
        spec = ACTIONS[action]
        entry = manifest["actions"][action]
        final_sheet = ROOT / entry["finalSheet"]
        cells = extract_cells(
            final_sheet,
            int(entry["frameWidth"]),
            int(entry["frameHeight"]),
            int(entry["frameCount"]),
            int(entry["columns"]),
        )
        planned = {
            int(index): int(dx)
            for index, dx in spec.get("frameTranslationsX", {}).items()
            if int(dx) != 0
        }
        uniform = int(spec.get("uniformTranslationX", 0))
        if uniform:
            planned = {index: uniform for index in range(len(cells))}
            planned.update({int(index): int(dx) for index, dx in spec.get("frameTranslationsX", {}).items()})
        recorded = {
            int(index): int(dx)
            for index, dx in entry.get("validation", {}).get("wholeFrameTranslationsX", {}).items()
        }
        if planned and recorded != planned:
            applied = apply_frame_translations_x(cells, spec)
            Image.fromarray(compose(cells, int(entry["columns"])), "RGBA").save(
                final_sheet, optimize=True, compress_level=9)
        else:
            applied = recorded
        gif, contact, timing = write_previews(action, cells, int(entry["durationMs"]))
        validation = validate(cells)
        validation.update({
            "originalKeyFramesPreservedAtEvenIndicesBeforeWholeFrameTranslation":
                entry.get("validation", {}).get("originalKeyFramesPreservedAtEvenIndices", True),
            "oddFrameRedChromaPixelsRepaired":
                entry.get("validation", {}).get("oddFrameRedChromaPixelsRepaired", [0] * len(cells)),
            "wholeFrameTranslationsX": applied,
            "translationMode": "whole-frame integer pixels; no scale or warp",
        })
        entry["previewGif"] = str(gif.relative_to(ROOT)).replace("\\", "/")
        entry["contactSheet"] = str(contact.relative_to(ROOT)).replace("\\", "/")
        entry["gifTimingMs"] = timing
        entry["pngBytes"] = final_sheet.stat().st_size
        entry["validation"] = validation
        for key in ("contactFrame", "activeFrames"):
            if key in spec:
                entry[key] = spec[key]
        print(f"[musk-ox-formal] postprocessed {action}", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    if args.postprocess_existing:
        actions = [part.strip() for part in args.postprocess_existing.split(",") if part.strip()]
        postprocess_existing(actions)
        return
    if not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")
    for directory in (SOURCE_DIR, FINAL_DIR, REPORT_DIR, PREVIEW_ROOT):
        directory.mkdir(parents=True, exist_ok=True)
    model = get_model()
    idle_frames, _ = decode(ACTIONS["idle"]["video"])
    idle_cutout = cutout(idle_frames[0], model)
    ix0, iy0, ix1, iy1 = bbox(idle_cutout)
    base_scale = REFERENCE_BODY_HEIGHT / (iy1 - iy0 + 1)
    idle_ref_box = reference_bbox(IDLE_REF)
    idle_ref_width = idle_ref_box[2] - idle_ref_box[0] + 1
    multipliers = {}
    for action, spec in ACTIONS.items():
        ref_box = reference_bbox(spec["reference"])
        multipliers[action] = idle_ref_width / (ref_box[2] - ref_box[0] + 1)

    manifest = {
        "asset": "frostback-musk-ox",
        "stage": "formal-four-action-runtime-ready",
        "budgetTier": "crowd",
        "runtimeIntegrationActive": True,
        "facing": "screen-right",
        "sourceVideoFps": 24,
        "interpolationPasses": 1,
        "baseScale": base_scale,
        "actionScaleMultipliers": multipliers,
        "runtimeTargetHeight": RUNTIME_TARGET_HEIGHT,
        "actions": {},
    }
    for action, spec in ACTIONS.items():
        high_cells = make_high_cells(spec, model, base_scale, multipliers[action])
        compact, width = compact_cells(high_cells)
        source_cols = min(5, len(compact))
        source_sheet = SOURCE_DIR / f"{action}.png"
        Image.fromarray(compose(compact, source_cols), "RGBA").save(source_sheet, optimize=True, compress_level=9)
        source_rate = len(compact) * 1000 / spec["durationMs"]
        final_sheet = FINAL_DIR / f"{action}.png"
        report_path = REPORT_DIR / f"{action}-rife.json"
        command = [
            sys.executable, str(RIFE_TOOL), "--sheet", str(source_sheet), "--out", str(final_sheet),
            "--name", f"frostback-musk-ox-{action}", "--frame-width", str(width),
            "--frame-height", str(RUNTIME_HEIGHT), "--cols", str(source_cols),
            "--frame-count", str(len(compact)), "--frame-rate", str(source_rate),
            "--mode", spec["rifeMode"], "--out-cols", str(spec["finalCols"]),
            "--preview-dir", str(PREVIEW_ROOT / action / "rife-tool"),
            "--report", str(report_path), "--rife", str(RIFE_EXE), "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)
        rife_report = json.loads(report_path.read_text(encoding="utf-8"))
        final_count = int(rife_report["outputFrameCount"])
        final_cells = extract_cells(final_sheet, width, RUNTIME_HEIGHT, final_count, spec["finalCols"])
        # The shared RIFE tool already ran its temporal outlier detector. It
        # reported no red/magenta artifacts for this naturally warm-brown unit;
        # do not run a second color heuristic that could erase real fur tones.
        red_repairs = [0] * len(final_cells)
        key_frames_preserved = all(
            np.array_equal(source, final_cells[index * 2]) for index, source in enumerate(compact))
        frame_translations = apply_frame_translations_x(final_cells, spec)
        Image.fromarray(compose(final_cells, spec["finalCols"]), "RGBA").save(
            final_sheet, optimize=True, compress_level=9)
        gif, contact, timing = write_previews(action, final_cells, spec["durationMs"])
        validation = validate(final_cells)
        validation["originalKeyFramesPreservedAtEvenIndicesBeforeWholeFrameTranslation"] = key_frames_preserved
        validation["oddFrameRedChromaPixelsRepaired"] = red_repairs
        validation["wholeFrameTranslationsX"] = frame_translations
        validation["translationMode"] = "whole-frame integer pixels; no scale or warp"
        with Image.open(final_sheet) as atlas:
            atlas_width, atlas_height = atlas.size
        decoded_bytes = atlas_width * atlas_height * 4
        entry = {
            "sourceVideo": str(spec["video"].relative_to(ROOT)).replace("\\", "/"),
            "selectedSourceFrames": spec["sourceFrames"],
            "sourceSheet": str(source_sheet.relative_to(ROOT)).replace("\\", "/"),
            "finalSheet": str(final_sheet.relative_to(ROOT)).replace("\\", "/"),
            "previewGif": str(gif.relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str(contact.relative_to(ROOT)).replace("\\", "/"),
            "rifeReport": str(report_path.relative_to(ROOT)).replace("\\", "/"),
            "frameWidth": width,
            "frameHeight": RUNTIME_HEIGHT,
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
            "footY": RUNTIME_FOOT_Y,
            "decodedRgbaBytes": decoded_bytes,
            "decodedRgbaMiB": round(decoded_bytes / 1024 / 1024, 4),
            "pngBytes": final_sheet.stat().st_size,
            "gifTimingMs": timing,
            "validation": validation,
        }
        for key in ("sourceContract", "sourceWindow", "sourceWindowSemantics", "sourceVideoFps",
                    "sourceWallClockMs", "excludedRepeatedStrikeRanges", "contactFrame",
                    "activeFrames", "settledFromSourceFrame"):
            if key in spec:
                entry[key] = spec[key]
        manifest["actions"][action] = entry
        print(f"[musk-ox-formal] built {action}: {width}x{RUNTIME_HEIGHT} x {final_count}", flush=True)

    total = sum(int(entry["decodedRgbaBytes"]) for entry in manifest["actions"].values())
    manifest.update({
        "decodedRgbaBytes": total,
        "decodedRgbaMiB": round(total / 1024 / 1024, 4),
        "budgetTargetMiB": 32,
        "budgetHardStopMiB": 64,
        "budgetWithinTarget": total <= 32 * 1024 * 1024,
        "budgetWithinHardStop": total <= 64 * 1024 * 1024,
    })
    (ROOT / "sprite-sheet-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
