#!/usr/bin/env python3
"""Apply one fixed, uniform scale per action around the runtime root/foot.

This is intentionally an action-level correction. It never estimates or changes
scale per frame, never stretches one axis independently, and never adds motion.
The same transform is applied to pre-RIFE source keys and final RIFE frames so
the formal source/final contract remains inspectable.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SPRITES = ROOT / "spritesheets"
QA = ROOT / "qa"
REPO = ROOT.parents[3]

SCALE_FACTORS = {
    "ice-crown-lynx": {"idle": 1.0, "running": 0.912, "attack": 0.953, "death": 1.0},
    "glacierback-war-ox": {"idle": 1.0, "running": 1.04, "attack": 1.148, "death": 0.928},
    "abyss-crystal-ravager": {"idle": 1.0, "running": 1.0, "attack": 0.909, "death": 0.96},
    "frostbound-centurion": {"idle": 1.0, "running": 1.0, "attack": 0.87, "death": 0.793},
    "polar-night-high-priest": {"idle": 1.0, "running": 1.0, "attack": 1.0, "death": 1.28},
}

RUNTIME_FILES = {
    "ice-crown-lynx": "ice_crown_lynx",
    "glacierback-war-ox": "glacierback_war_ox",
    "abyss-crystal-ravager": "abyss_crystal_ravager",
    "frostbound-centurion": "frostbound_centurion",
    "polar-night-high-priest": "polar_night_high_priest",
}

CONFIG_KEYS = {
    "ice-crown-lynx": "iceCrownLynx",
    "glacierback-war-ox": "glacierbackWarOx",
    "abyss-crystal-ravager": "abyssCrystalRavager",
    "frostbound-centurion": "frostboundCenturion",
    "polar-night-high-priest": "polarNightHighPriest",
}

ACTION_FILES = {"idle": "idle", "running": "running", "attack": "attacking", "death": "dying"}
ORDER = ("idle", "running", "attack", "death")
BASE_FRAME_HEIGHTS = {
    "ice-crown-lynx": 240,
    "glacierback-war-ox": 240,
    "abyss-crystal-ravager": 240,
    "frostbound-centurion": 272,
    "polar-night-high-priest": 288,
}


def alpha_bbox(frame: np.ndarray, threshold: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.where(frame[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def extract(path: Path, width: int, height: int, count: int, cols: int) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(path).convert("RGBA"))
    return [sheet[(i // cols) * height:(i // cols + 1) * height,
                  (i % cols) * width:(i % cols + 1) * width].copy()
            for i in range(count)]


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    height, width = cells[0].shape[:2]
    sheet = np.zeros((math.ceil(len(cells) / cols) * height, cols * width, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def round32(value: int) -> int:
    return max(32, math.ceil(value / 32) * 32)


def plan_geometry(cells: list[np.ndarray], factor: float, root_x: int, foot_y: int) -> dict:
    height, width = cells[0].shape[:2]
    min_rel_x = min_rel_y = 0
    max_rel_x = max_rel_y = 0
    for frame in cells:
        x0, y0, x1, y1 = alpha_bbox(frame)
        resized_w = max(1, round((x1 - x0 + 1) * factor))
        resized_h = max(1, round((y1 - y0 + 1) * factor))
        rel_x = round((x0 - root_x) * factor)
        rel_y = round((y0 - foot_y) * factor)
        min_rel_x = min(min_rel_x, rel_x)
        max_rel_x = max(max_rel_x, rel_x + resized_w)
        min_rel_y = min(min_rel_y, rel_y)
        max_rel_y = max(max_rel_y, rel_y + resized_h)
    output_width = round32(max(width, 2 * max(-min_rel_x, max_rel_x) + 8))
    output_root_x = output_width // 2
    extra_top = max(0, 3 - (foot_y + min_rel_y))
    output_foot_y = foot_y + extra_top
    required_height = max(height + extra_top, output_foot_y + max_rel_y + 3)
    output_height = height if required_height <= height else round32(required_height)
    return {
        "frameWidth": output_width,
        "frameHeight": output_height,
        "footX": output_root_x,
        "footY": output_foot_y,
    }


def scale_about_root(
        frame: np.ndarray, factor: float, root_x: int, foot_y: int, geometry: dict) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(frame)
    crop = frame[y0:y1 + 1, x0:x1 + 1]
    size = (max(1, round(crop.shape[1] * factor)), max(1, round(crop.shape[0] * factor)))
    resized = (crop.copy() if factor == 1.0 else
               np.asarray(Image.fromarray(crop, "RGBA").resize(size, Image.Resampling.LANCZOS)))
    x = round(geometry["footX"] + (x0 - root_x) * factor)
    y = round(geometry["footY"] + (y0 - foot_y) * factor)
    width, height = geometry["frameWidth"], geometry["frameHeight"]
    if x < 3 or y < 3 or x + size[0] > width - 3 or y + size[1] > height - 3:
        raise RuntimeError(
            f"fixed action scale clips: factor={factor} content={size} at ({x},{y}) in {width}x{height}")
    out = np.zeros((height, width, 4), dtype=np.uint8)
    out[y:y + size[1], x:x + size[0]] = resized
    out[out[..., 3] == 0, :3] = 0
    return out


def checker(frame: np.ndarray) -> Image.Image:
    yy, xx = np.indices(frame.shape[:2])
    shade = np.where(((xx // 16 + yy // 16) % 2)[..., None], 58, 82)
    bg = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = frame[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(np.clip(frame[..., :3] * alpha + bg * (1 - alpha), 0, 255).astype(np.uint8))


def durations(count: int, total_ms: int) -> list[int]:
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / count / 10) for index in range(count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF durations: {values}")
    return values


def write_previews(slug: str, action: str, cells: list[np.ndarray], total_ms: int) -> tuple[Path, Path, list[int]]:
    out_dir = SPRITES / slug / "previews" / action
    out_dir.mkdir(parents=True, exist_ok=True)
    timing = durations(len(cells), total_ms)
    frames = [checker(cell) for cell in cells]
    gif = out_dir / f"{slug}-{action}.gif"
    frames[0].save(gif, save_all=True, append_images=frames[1:], duration=timing,
                   loop=0, disposal=2, optimize=False)
    height, width = cells[0].shape[:2]
    tw, th, label_h, cols = max(1, width // 2), max(1, height // 2), 22, 6
    contact = Image.new("RGB", (cols * tw, math.ceil(len(cells) / cols) * (th + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, cell in enumerate(cells):
        x, y = (index % cols) * tw, (index // cols) * (th + label_h)
        contact.paste(checker(cell).resize((tw, th), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 4, y + th + 3), f"f{index} {'key' if index % 2 == 0 else 'RIFE'}", fill="white")
    contact_path = out_dir / f"{slug}-{action}-contact.png"
    contact.save(contact_path)
    return gif, contact_path, timing


def validate(cells: list[np.ndarray]) -> dict:
    boxes = [alpha_bbox(cell) for cell in cells]
    duplicates = [[left, right] for left in range(len(cells)) for right in range(left + 1, len(cells))
                  if np.array_equal(cells[left], cells[right])]
    return {
        "emptyFrames": [],
        "touchingFrames": [index for index, (x0, y0, x1, y1) in enumerate(boxes)
                           if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3
                           or y1 >= cells[index].shape[0] - 3],
        "alphaBottomMin": min(box[3] for box in boxes),
        "alphaBottomMax": max(box[3] for box in boxes),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells),
        "exactDuplicateFramePairs": duplicates,
    }


def make_qa(slug: str, transformed: dict[str, dict], suffix: str) -> Path:
    QA.mkdir(parents=True, exist_ok=True)
    panel_w, panel_h, label_h = 420, 320, 28
    image = Image.new("RGB", (panel_w * len(ORDER), panel_h + label_h), "#323841")
    draw = ImageDraw.Draw(image)
    target_root_x, target_foot_y = panel_w // 2, panel_h - 26
    for col, action in enumerate(ORDER):
        entry = transformed[action]
        cell = entry["cells"][0]
        rgba = Image.fromarray(cell, "RGBA")
        x = col * panel_w + target_root_x - int(entry["footX"])
        y = target_foot_y - int(entry["footY"])
        tile = Image.new("RGB", (panel_w, panel_h), "#323841")
        tile.paste(rgba, (x - col * panel_w, y), rgba)
        image.paste(tile, (col * panel_w, 0))
        draw.line((col * panel_w + target_root_x, target_foot_y - 6,
                   col * panel_w + target_root_x, target_foot_y + 6), fill="#ffde59", width=1)
        draw.text((col * panel_w + 8, panel_h + 6),
                  f"{action}  fixed scale {SCALE_FACTORS[slug][action]:.3f}", fill="white")
    path = QA / f"{slug}-{suffix}-f0-root-aligned.png"
    image.save(path)
    return path


def load_raw(path: Path, entry: dict, source: bool) -> tuple[list[np.ndarray], int]:
    count = len(entry["selectedSourceFrames"]) if source else int(entry["frameCount"])
    cols = Image.open(path).size[0] // int(entry["frameWidth"]) if source else int(entry["columns"])
    return extract(path, int(entry["frameWidth"]), int(entry["frameHeight"]), count, cols), cols


def build_transforms(slug: str, manifest: dict) -> tuple[dict[str, dict], dict[str, dict]]:
    transformed_source = {}
    transformed_final = {}
    for action in ORDER:
        entry = manifest["actions"][action]
        source_path, final_path = ROOT / entry["sourceSheet"], ROOT / entry["finalSheet"]
        source_cells, source_cols = load_raw(source_path, entry, source=True)
        final_cells, final_cols = load_raw(final_path, entry, source=False)
        factor = SCALE_FACTORS[slug][action]
        geometry = plan_geometry(source_cells + final_cells, factor, int(entry["footX"]), int(entry["footY"]))
        common = {**geometry, "factor": factor}
        transformed_source[action] = {
            **common, "cols": source_cols,
            "cells": [scale_about_root(cell, factor, int(entry["footX"]), int(entry["footY"]), geometry)
                      for cell in source_cells],
        }
        transformed_final[action] = {
            **common, "cols": final_cols,
            "cells": [scale_about_root(cell, factor, int(entry["footX"]), int(entry["footY"]), geometry)
                      for cell in final_cells],
        }
    return transformed_source, transformed_final


def preview() -> None:
    for slug in SCALE_FACTORS:
        manifest = json.loads((SPRITES / slug / "manifest.json").read_text(encoding="utf-8"))
        if "scaleNormalization" in manifest:
            transformed = {}
            for action in ORDER:
                entry = manifest["actions"][action]
                cells, cols = load_raw(ROOT / entry["finalSheet"], entry, source=False)
                transformed[action] = {
                    "frameWidth": entry["frameWidth"], "frameHeight": entry["frameHeight"],
                    "footX": entry["footX"], "footY": entry["footY"],
                    "factor": entry["fixedWholeActionScaleFactor"], "cols": cols, "cells": cells,
                }
            print(make_qa(slug, transformed, "normalized"))
        else:
            _source, transformed = build_transforms(slug, manifest)
            print(make_qa(slug, transformed, "proposed"))


def apply() -> None:
    combined_path = ROOT / "formal-sprite-manifest.json"
    combined = json.loads(combined_path.read_text(encoding="utf-8"))
    combined["stage"] = "formal-assets-scale-normalized_and_runtime_integrated_static"
    combined["gameIntegrated"] = True
    combined["runtimeTested"] = False
    combined["scaleNormalization"] = {
        "baselineAction": "idle",
        "mode": "one fixed uniform factor per whole action around footX/footY; no per-frame scale, warp, or added motion",
        "factors": SCALE_FACTORS,
    }
    for slug, factors in SCALE_FACTORS.items():
        manifest_path = SPRITES / slug / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if "scaleNormalization" in manifest:
            raise RuntimeError(f"{slug} already has scale normalization; refusing double application")
        source, final = build_transforms(slug, manifest)
        make_qa(slug, final, "normalized")
        manifest["runtimeIntegrationActive"] = True
        manifest["status"] = "formal-four-action-assets-scale-normalized_and_runtime_integrated_static"
        manifest["actionScaleMultipliers"] = factors
        manifest["scaleNormalization"] = {
            "baselineAction": "idle",
            "method": "neutral-body feature match plus root-aligned visual review",
            "transform": "one fixed uniform factor per action around footX/footY",
            "fixedWholeActionScaleFactors": factors,
            "perFrameScale": False,
            "nonUniformScale": False,
            "addedRootMotion": False,
        }
        for action in ORDER:
            entry = manifest["actions"][action]
            source_path = ROOT / entry["sourceSheet"]
            final_path = ROOT / entry["finalSheet"]
            source_cells, final_cells = source[action]["cells"], final[action]["cells"]
            Image.fromarray(compose(source_cells, source[action]["cols"]), "RGBA").save(
                source_path, optimize=True, compress_level=9)
            Image.fromarray(compose(final_cells, final[action]["cols"]), "RGBA").save(
                final_path, optimize=True, compress_level=9)
            key_frames_preserved = all(
                np.array_equal(source_cell, final_cells[index * 2])
                for index, source_cell in enumerate(source_cells))
            gif, contact, timing = write_previews(
                slug, action, final_cells, int(entry["durationMs"]))
            old_validation = entry.get("validation", {})
            validation = validate(final_cells)
            validation["originalKeyFramesPreservedAtEvenIndicesBeforeWholeFrameTranslation"] = key_frames_preserved
            validation["oddFrameRedChromaPixelsRepaired"] = old_validation.get(
                "oddFrameRedChromaPixelsRepaired", [0] * len(final_cells))
            validation["wholeFrameTranslationsX"] = old_validation.get("wholeFrameTranslationsX", {})
            validation["translationMode"] = (
                "fixed whole-action uniform scale around footX/footY; whole-frame integer translations only; "
                "no per-frame scale, non-uniform warp, or added root motion")
            entry["fixedWholeActionScaleFactor"] = factors[action]
            entry["frameWidth"] = final[action]["frameWidth"]
            entry["frameHeight"] = final[action]["frameHeight"]
            entry["footX"] = final[action]["footX"]
            entry["footY"] = final[action]["footY"]
            entry["atlasWidth"] = final[action]["frameWidth"] * final[action]["cols"]
            entry["atlasHeight"] = final[action]["frameHeight"] * math.ceil(
                len(final_cells) / final[action]["cols"])
            entry["decodedRgbaBytes"] = entry["atlasWidth"] * entry["atlasHeight"] * 4
            entry["decodedRgbaMiB"] = round(entry["decodedRgbaBytes"] / 1024 / 1024, 4)
            entry["pngBytes"] = final_path.stat().st_size
            entry["gifTimingMs"] = timing
            entry["validation"] = validation
            entry["previewGif"] = str(gif.relative_to(ROOT)).replace("\\", "/")
            entry["contactSheet"] = str(contact.relative_to(ROOT)).replace("\\", "/")
            runtime = REPO / "assets" / "enemies" / RUNTIME_FILES[slug] / f"{ACTION_FILES[action]}.png"
            runtime.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(final_path, runtime)
            combined_entry = combined["units"][slug]["actions"][action]
            combined_entry["fixedWholeActionScaleFactor"] = factors[action]
            for key in ("frameWidth", "frameHeight", "footX", "footY"):
                combined_entry[key] = entry[key]
        total = sum(int(entry["decodedRgbaBytes"]) for entry in manifest["actions"].values())
        manifest["decodedRgbaBytes"] = total
        manifest["decodedRgbaMiB"] = round(total / 1024 / 1024, 4)
        manifest["budgetWithinTarget"] = total <= int(manifest.get("budgetTargetMiB", 64)) * 1024 * 1024
        manifest["budgetWithinHardStop"] = total <= int(manifest.get("budgetHardStopMiB", 64)) * 1024 * 1024
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        combined["units"][slug]["decodedRgbaMiB"] = manifest["decodedRgbaMiB"]
        combined["units"][slug]["withinSpecialistTarget64MiB"] = total <= 64 * 1024 * 1024
    combined["combinedDecodedRgbaMiB"] = round(sum(
        float(unit["decodedRgbaMiB"]) for unit in combined["units"].values()), 4)
    combined_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")


def report() -> None:
    config = json.loads((REPO / "data" / "enemy-config.json").read_text(encoding="utf-8"))
    output = {}
    for slug, config_key in CONFIG_KEYS.items():
        manifest = json.loads((SPRITES / slug / "manifest.json").read_text(encoding="utf-8"))
        unit_cfg = config[config_key]
        pixel_scale = float(unit_cfg["render"]["spriteSize"]) / float(unit_cfg["textures"]["referenceCell"])
        unit = {"pixelScale": pixel_scale, "actions": {}}
        for action in ORDER:
            entry = manifest["actions"][action]
            path = ROOT / entry["finalSheet"]
            cells, _cols = load_raw(path, entry, source=False)
            boxes = [alpha_bbox(cell) for cell in cells]
            action_report = {
                "factor": entry["fixedWholeActionScaleFactor"],
                "frame": [entry["frameWidth"], entry["frameHeight"]],
                "foot": [entry["footX"], entry["footY"]],
                "rightEdgeWorldMinMax": [
                    round(min(box[2] - entry["footX"] for box in boxes) * pixel_scale, 2),
                    round(max(box[2] - entry["footX"] for box in boxes) * pixel_scale, 2),
                ],
                "alphaBottomMinusFootMinMax": [
                    min(box[3] - entry["footY"] for box in boxes),
                    max(box[3] - entry["footY"] for box in boxes),
                ],
                "touchingFrames": entry["validation"]["touchingFrames"],
            }
            if action == "attack":
                contact = int(entry["contactFrame"])
                active_start, active_end = (int(value) for value in entry["activeFrames"])
                action_report["contactFrame"] = contact
                action_report["contactRightEdgeWorld"] = round(
                    (boxes[contact][2] - entry["footX"]) * pixel_scale, 2)
                action_report["activeRightEdgeWorldMinMax"] = [
                    round(min(boxes[index][2] - entry["footX"]
                              for index in range(active_start, active_end + 1)) * pixel_scale, 2),
                    round(max(boxes[index][2] - entry["footX"]
                              for index in range(active_start, active_end + 1)) * pixel_scale, 2),
                ]
            unit["actions"][action] = action_report
        output[config_key] = unit
    print(json.dumps(output, ensure_ascii=False, indent=2))


def trim_canvas() -> None:
    """Remove post-scale blank rows while preserving every visible pixel and foot coordinate."""
    combined_path = ROOT / "formal-sprite-manifest.json"
    combined = json.loads(combined_path.read_text(encoding="utf-8"))
    for slug, target_height in BASE_FRAME_HEIGHTS.items():
        manifest_path = SPRITES / slug / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for action in ORDER:
            entry = manifest["actions"][action]
            source_path, final_path = ROOT / entry["sourceSheet"], ROOT / entry["finalSheet"]
            source_cells, source_cols = load_raw(source_path, entry, source=True)
            final_cells, final_cols = load_raw(final_path, entry, source=False)
            for frame in source_cells + final_cells:
                if alpha_bbox(frame)[3] > target_height - 3:
                    raise RuntimeError(f"{slug}/{action} cannot trim to {target_height} without clipping")
            source_cells = [frame[:target_height].copy() for frame in source_cells]
            final_cells = [frame[:target_height].copy() for frame in final_cells]
            Image.fromarray(compose(source_cells, source_cols), "RGBA").save(
                source_path, optimize=True, compress_level=9)
            Image.fromarray(compose(final_cells, final_cols), "RGBA").save(
                final_path, optimize=True, compress_level=9)
            gif, contact, timing = write_previews(slug, action, final_cells, int(entry["durationMs"]))
            validation = validate(final_cells)
            validation["originalKeyFramesPreservedAtEvenIndicesBeforeWholeFrameTranslation"] = all(
                np.array_equal(source_cell, final_cells[index * 2])
                for index, source_cell in enumerate(source_cells))
            validation["oddFrameRedChromaPixelsRepaired"] = entry["validation"].get(
                "oddFrameRedChromaPixelsRepaired", [0] * len(final_cells))
            validation["wholeFrameTranslationsX"] = entry["validation"].get("wholeFrameTranslationsX", {})
            validation["translationMode"] = entry["validation"]["translationMode"]
            entry["frameHeight"] = target_height
            entry["atlasHeight"] = target_height * math.ceil(len(final_cells) / final_cols)
            entry["decodedRgbaBytes"] = entry["atlasWidth"] * entry["atlasHeight"] * 4
            entry["decodedRgbaMiB"] = round(entry["decodedRgbaBytes"] / 1024 / 1024, 4)
            entry["pngBytes"] = final_path.stat().st_size
            entry["gifTimingMs"] = timing
            entry["validation"] = validation
            entry["previewGif"] = str(gif.relative_to(ROOT)).replace("\\", "/")
            entry["contactSheet"] = str(contact.relative_to(ROOT)).replace("\\", "/")
            runtime = REPO / "assets" / "enemies" / RUNTIME_FILES[slug] / f"{ACTION_FILES[action]}.png"
            shutil.copy2(final_path, runtime)
            combined["units"][slug]["actions"][action]["frameHeight"] = target_height
        total = sum(int(entry["decodedRgbaBytes"]) for entry in manifest["actions"].values())
        manifest["decodedRgbaBytes"] = total
        manifest["decodedRgbaMiB"] = round(total / 1024 / 1024, 4)
        manifest["budgetWithinTarget"] = total <= int(manifest.get("budgetTargetMiB", 64)) * 1024 * 1024
        manifest["budgetWithinHardStop"] = total <= int(manifest.get("budgetHardStopMiB", 64)) * 1024 * 1024
        manifest["canvasNormalization"] = (
            "blank rows trimmed back to the established compact action height; footY and visible pixels unchanged")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        combined["units"][slug]["decodedRgbaMiB"] = manifest["decodedRgbaMiB"]
        combined["units"][slug]["withinSpecialistTarget64MiB"] = total <= 64 * 1024 * 1024
    combined["combinedDecodedRgbaMiB"] = round(sum(
        float(unit["decodedRgbaMiB"]) for unit in combined["units"].values()), 4)
    combined["canvasNormalization"] = (
        "blank rows trimmed to established compact heights; foot coordinates and visible pixels preserved")
    combined_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="overwrite formal/runtime assets after preview review")
    parser.add_argument("--report", action="store_true", help="print offline root/edge metrics for normalized sheets")
    parser.add_argument("--trim-canvas", action="store_true", help="trim only blank rows after fixed action scaling")
    args = parser.parse_args()
    if sum((args.apply, args.report, args.trim_canvas)) > 1:
        parser.error("choose one operation")
    if args.apply:
        apply()
    elif args.report:
        report()
    elif args.trim_canvas:
        trim_canvas()
    else:
        preview()


if __name__ == "__main__":
    main()
