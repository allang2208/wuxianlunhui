#!/usr/bin/env python3
"""Remove studio-white RGB reintroduced by RGBA RIFE interpolation."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
POST = ROOT / "postprocess"
SOURCE_REPORT = POST / "formal-source-report.json"
SHEET_DIR = POST / "sheets-rife"
CUTOUT_DIR = POST / "selected-cutouts"
EFFECT_DIR = POST / "effect-masks-rife"
REPORT_PATH = POST / "formal-rife-edge-cleanup-report.json"
BASE_PATH = REPO / "tools" / "ai-gen" / "_hamster_champion_plate_h3_20260901" / "build-runtime-source-sheets.py"


def import_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = import_module(BASE_PATH, "steel_shield_edge_cleanup_base")


def placed_effect_mask(raw_index: int, spec: dict[str, object]) -> np.ndarray:
    frame_width = int(spec["frameWidth"])
    frame_height = int(spec["frameHeight"])
    output = np.zeros((frame_height, frame_width), np.uint8)
    effect_path = CUTOUT_DIR / "attacking" / "effect-masks" / f"source-f{raw_index:03d}.png"
    if not effect_path.exists():
        return output

    rgba = np.asarray(Image.open(CUTOUT_DIR / "attacking" / f"source-f{raw_index:03d}.png").convert("RGBA"))
    raw_mask = np.asarray(Image.open(effect_path).convert("L"))
    if raw_mask.shape != rgba.shape[:2]:
        raise ValueError(f"effect mask size mismatch: {effect_path}")
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    crop = raw_mask[y0:y1 + 1, x0:x1 + 1]
    scale = float(spec["fixedActionScale"])
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(Image.fromarray(crop, "L").resize((width, height), Image.Resampling.LANCZOS))
    anchor = spec["fixedSourceAnchor"]
    offset_x = round(frame_width / 2 + (x0 - float(anchor["x"])) * scale)
    offset_y = round(int(spec["footY"]) + (y0 - float(anchor["y"])) * scale)
    output[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return output


def attack_effect_masks(spec: dict[str, object]) -> list[np.ndarray]:
    sources = [placed_effect_mask(int(index), spec) for index in spec["sourceIndices"]]
    outputs: list[np.ndarray] = []
    kernel = np.ones((3, 3), np.uint8)
    for index, mask in enumerate(sources):
        outputs.append(mask)
        if index + 1 < len(sources):
            # The full-frame RIFE flow can move the interpolated smoke by about
            # one output pixel. Preserve a narrow union around both source masks.
            middle = np.maximum(mask, sources[index + 1])
            middle = cv2.dilate((middle > 0).astype(np.uint8), kernel, iterations=1) * 255
            outputs.append(middle)
    expected = int(spec["finalFrameCount"])
    if len(outputs) != expected:
        raise RuntimeError(f"attack effect mask count {len(outputs)} != {expected}")
    return outputs


def extract_cells(sheet: np.ndarray, spec: dict[str, object]) -> list[np.ndarray]:
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    cells = []
    for index in range(int(spec["finalFrameCount"])):
        row, col = divmod(index, 8)
        cells.append(sheet[row * height:(row + 1) * height, col * width:(col + 1) * width].copy())
    return cells


def compose_masks(cells: list[np.ndarray], spec: dict[str, object]) -> np.ndarray:
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    rows = math.ceil(len(cells) / 8)
    sheet = np.zeros((rows * height, 8 * width), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, 8)
        sheet[row * height:(row + 1) * height, col * width:(col + 1) * width] = cell
    return sheet


def clean_cell(rgba: np.ndarray, preserve: np.ndarray | None) -> tuple[np.ndarray, int]:
    alpha = rgba[..., 3]
    whiteish = np.all(rgba[..., :3] >= 235, axis=2)
    target = (alpha > 10) & (alpha < 245) & whiteish
    if preserve is not None:
        target &= preserve == 0
    if not target.any():
        return rgba, 0

    reliable = (alpha >= 245) & ~whiteish
    if not reliable.any():
        raise RuntimeError("no reliable subject colour available for edge cleanup")
    _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
    output = rgba.copy()
    output[..., :3][target] = rgba[..., :3][nearest[0][target], nearest[1][target]]
    output[output[..., 3] == 0, :3] = 0
    return output, int(target.sum())


def remove_ground_contact_matte(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove the pale studio-floor strip attached below boots and shield."""
    alpha = rgba[..., 3]
    visible = alpha > 0
    if not visible.any():
        return rgba, 0
    inside = ndimage.distance_transform_edt(visible)
    ys, _ = np.where(alpha > 32)
    if not len(ys):
        return rgba, 0
    y0 = int(ys.min())
    y1 = int(ys.max())
    yy, xx = np.indices(alpha.shape)
    xs = np.where(alpha > 32)[1]
    x0 = int(xs.min())
    x1 = int(xs.max())
    rgb = rgba[..., :3].astype(np.float32)
    luma = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    target = (
        visible
        & (inside <= 6.0)
        & (yy >= y0 + 0.72 * (y1 - y0 + 1))
        & (xx >= x0 + 0.05 * (x1 - x0 + 1))
        & (luma >= 100.0)
        & (chroma <= 100.0)
        & (alpha >= 8)
    )
    if not target.any():
        return rgba, 0
    output = rgba.copy()
    output[target] = 0
    removed = int(target.sum())
    for _ in range(4):
        alpha = output[..., 3]
        visible = alpha > 0
        ys, xs = np.where(alpha > 32)
        if not len(ys):
            break
        inside = ndimage.distance_transform_edt(visible)
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        yy, xx = np.indices(alpha.shape)
        rgb = output[..., :3].astype(np.float32)
        luma = rgb.mean(axis=2)
        chroma = rgb.max(axis=2) - rgb.min(axis=2)
        neutral = (
            visible
            & (inside <= 6.0)
            & (yy >= y0 + 0.72 * (y1 - y0 + 1))
            & (xx >= x0 + 0.05 * (x1 - x0 + 1))
            & (luma >= 150.0)
            & (chroma <= 40.0)
            & (alpha >= 8)
        )
        if not neutral.any():
            break
        output[neutral] = 0
        removed += int(neutral.sum())
    return output, removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action", action="append", choices=("idle", "running", "attacking", "dying"),
        help="clean only the named action; may be repeated",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    existing = json.loads(REPORT_PATH.read_text(encoding="utf-8")) if selected and REPORT_PATH.exists() else {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "assetOnly": True,
        "runtimeIntegration": False,
        "rule": "remove pale connected ground-contact matte below boots/shield for moving and attack, then recolour remaining alpha in (10,245) and RGB >=235 from nearest opaque non-white actor pixel",
        "actions": {},
    }
    existing["rule"] = "remove pale connected ground-contact matte below boots/shield for moving and attack, iteratively peel newly exposed neutral-gray floor islands, then recolour remaining alpha in (10,245) and RGB >=235 from nearest opaque non-white actor pixel"
    EFFECT_DIR.mkdir(parents=True, exist_ok=True)

    for action, spec in source["actions"].items():
        if selected and action not in selected:
            continue
        sheet_path = SHEET_DIR / f"{action}.png"
        sheet = np.asarray(Image.open(sheet_path).convert("RGBA"))
        cells = extract_cells(sheet, spec)
        effect_masks = attack_effect_masks(spec) if action == "attacking" else [None] * len(cells)
        cleaned = []
        counts = []
        floor_counts = []
        for cell, preserve in zip(cells, effect_masks):
            floor_count = 0
            output = cell
            if action in {"running", "attacking"}:
                output, floor_count = remove_ground_contact_matte(output)
            output, count = clean_cell(output, preserve)
            cleaned.append(output)
            counts.append(count)
            floor_counts.append(floor_count)
        Image.fromarray(BASE.compose(cleaned, 8), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        if action == "attacking":
            Image.fromarray(compose_masks(effect_masks, spec), "L").save(
                EFFECT_DIR / "attacking.png", optimize=True, compress_level=9,
            )
        existing["actions"][action] = {
            "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
            "pixelsRecoloredByFrame": counts,
            "totalPixelsRecolored": sum(counts),
            "groundContactMattePixelsRemovedByFrame": floor_counts,
            "totalGroundContactMattePixelsRemoved": sum(floor_counts),
            "approvedEffectMask": (
                str((EFFECT_DIR / "attacking.png").relative_to(ROOT)).replace("\\", "/")
                if action == "attacking" else None
            ),
        }

    REPORT_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(existing, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
