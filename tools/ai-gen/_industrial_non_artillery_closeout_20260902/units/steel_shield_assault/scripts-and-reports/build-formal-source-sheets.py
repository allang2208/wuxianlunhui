#!/usr/bin/env python3
"""Build compact transparent steel-shield source sheets from approved videos.

Each action uses one fixed source-camera scale and one fixed source anchor.  The
four source cameras are normalized to the same 129 px effective upright body
height, while source-space root motion, shield motion, tail motion, fall motion,
and the approved attack flash/smoke are retained.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_PATH = REPO / "tools" / "ai-gen" / "_hamster_champion_plate_h3_20260901" / "build-runtime-source-sheets.py"


def import_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = import_module(BASE_PATH, "steel_shield_compact_base")
TARGET_BODY_HEIGHT = 129
POST = ROOT / "postprocess"
SOURCE_DIR = POST / "source-sheets-pre-rife"
CUTOUT_DIR = POST / "selected-cutouts"
PREVIEW_DIR = POST / "previews" / "source"
REPORT_PATH = POST / "formal-source-report.json"


@dataclass(frozen=True)
class ActionSpec:
    name: str
    config_key: str
    video_name: str
    indices: tuple[int, ...]
    source_sheet_fps: float
    runtime_fps: float
    repeat: int
    preserve_vertical_motion: bool = False


IDLE_DURATION_SECONDS = 123 / 24
ATTACK_DURATION_SECONDS = 1.5
DEATH_DURATION_SECONDS = 88 / 24

SPECS = (
    ActionSpec(
        "idle", "idle", "idle-h3-v01-exact-loop.mp4",
        (0, 7, 15, 23, 30, 38, 46, 53, 61, 69, 76, 84, 92, 99, 107, 115),
        16 / IDLE_DURATION_SECONDS, 32 / IDLE_DURATION_SECONDS, -1,
    ),
    ActionSpec(
        "running", "walk", "moving-doubao-v02-coat-covered.mp4",
        tuple(range(40, 61)), 24.0, 48.0, -1,
    ),
    ActionSpec(
        "attacking", "attack", "attacking-doubao-v01.mp4",
        (0, 6, 12, 18, 24, 30, 36, 42, 46, 48, 49, 50, 52, 54, 56, 58, 60, 62, 66, 72, 78, 84, 88, 93, 96),
        (49 / ATTACK_DURATION_SECONDS) / 2, 49 / ATTACK_DURATION_SECONDS, 0,
    ),
    ActionSpec(
        "dying", "dying", "dying-doubao-v01.mp4",
        tuple(range(0, 89, 4)), (45 / DEATH_DURATION_SECONDS) / 2,
        45 / DEATH_DURATION_SECONDS, 0, True,
    ),
)


def restore_attack_effect(
    rgb: np.ndarray, baseline_rgb: np.ndarray, rgba: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, int]:
    """Restore only the approved forward flash/smoke outside the actor matte."""
    if rgb.shape != baseline_rgb.shape:
        raise RuntimeError("attack effect baseline shape mismatch")
    alpha = rgba[..., 3]
    _, body_y0, _, body_y1 = BASE.body_bbox(rgba)
    _, _, alpha_x1, _ = BASE.alpha_bbox(rgba)
    body_h = body_y1 - body_y0 + 1
    yy, xx = np.indices(alpha.shape)
    roi = (
        (xx >= alpha_x1 - round(body_h * 0.18))
        & (xx < rgb.shape[1] - 8)
        & (yy >= body_y0 + round(body_h * 0.05))
        & (yy <= body_y0 + round(body_h * 0.62))
        & (alpha < 220)
    )

    current = rgb.astype(np.float32)
    baseline = baseline_rgb.astype(np.float32)
    delta = np.linalg.norm(current - baseline, axis=2)
    current_luma = current.mean(axis=2)
    baseline_luma = baseline.mean(axis=2)
    work = rgb.astype(np.int16)
    warm = (
        (work[..., 0] > 145)
        & (work[..., 0] - work[..., 2] > 28)
        & (work[..., 1] - work[..., 2] > 4)
    )
    smoke = baseline_luma - current_luma > 2.0
    seed = roi & (delta > 8.0) & (warm | smoke)
    candidate = cv2.morphologyEx(
        seed.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8),
    )
    candidate = cv2.dilate(candidate, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    effect = np.zeros_like(candidate, dtype=bool)
    near_muzzle = xx <= alpha_x1 + round(body_h * 0.13)
    for component in range(1, count):
        component_mask = labels == component
        area = int(stats[component, cv2.CC_STAT_AREA])
        if area >= 12 and ((component_mask & near_muzzle).any() or area >= 80):
            effect |= component_mask

    smoke_alpha = np.clip((delta - 5.0) * 7.0, 0, 220)
    warm_alpha = np.clip((delta - 3.0) * 13.0, 0, 255)
    effect_alpha = np.where(warm, warm_alpha, smoke_alpha)
    effect_alpha = np.where(effect, effect_alpha, 0).astype(np.uint8)
    new_alpha = np.maximum(alpha, effect_alpha)
    added = new_alpha > alpha
    output = rgba.copy()
    if added.any():
        a = np.maximum(effect_alpha.astype(np.float32) / 255.0, 1e-3)
        foreground = (current - (1.0 - a[..., None]) * baseline) / a[..., None]
        foreground = np.clip(foreground, 0, 255).astype(np.uint8)
        output[..., :3][added] = foreground[added]
        output[..., 3] = new_alpha
    output[output[..., 3] == 0, :3] = 0
    return output, effect_alpha, int(added.sum())


def replace_semtransparent_matte_rgb(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Keep alpha exactly while replacing white-matte edge RGB from the actor interior."""
    alpha = rgba[..., 3]
    background = BASE.detected_background(rgb)
    source_distance = np.linalg.norm(rgb.astype(np.float32) - background, axis=2)
    # A permissive source-distance threshold can accidentally nominate the
    # studio-gray halo itself as the nearest "opaque subject" colour.  Require
    # a clearly non-background interior pixel instead.
    reliable = (alpha >= 224) & (source_distance > 80.0)
    edge = (alpha > 0) & ~reliable
    if not edge.any() or not reliable.any():
        return rgba, 0
    _, nearest = BASE.ndimage.distance_transform_edt(~reliable, return_indices=True)
    output = rgba.copy()
    output[..., :3][edge] = rgba[..., :3][nearest[0][edge], nearest[1][edge]]
    output[alpha == 0, :3] = 0
    return output, int(edge.sum())


def trim_source_matte(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Suppress studio-background alpha in the outer 14 source pixels."""
    alpha = rgba[..., 3]
    visible = alpha > 0
    if not visible.any():
        return rgba, 0
    inside = BASE.ndimage.distance_transform_edt(visible)
    background = BASE.detected_background(rgb)
    distance = np.linalg.norm(rgb.astype(np.float32) - background, axis=2)
    edge_band = visible & (inside <= 14.0)
    # On this white studio source, the visible halo clusters around distance
    # 18..41 from the border median.  Clear that band outright and feather only
    # the 50..80 transition; final downscaling supplies the last antialias pixel.
    matte_cap = np.clip((distance - 50.0) / 30.0 * 255.0, 0, 255).astype(np.uint8)
    new_alpha = alpha.copy()
    new_alpha[edge_band] = np.minimum(new_alpha[edge_band], matte_cap[edge_band])
    new_alpha[new_alpha < 8] = 0
    changed = int(np.count_nonzero(new_alpha != alpha))
    output = rgba.copy()
    output[..., 3] = new_alpha
    output[new_alpha == 0, :3] = 0
    return output, changed


def remove_ground_contact_matte(cell: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove the pale studio-floor strip attached below boots and shield."""
    alpha = cell[..., 3]
    visible = alpha > 0
    ys, xs = np.where(alpha > 32)
    if not len(ys):
        return cell, 0
    inside = BASE.ndimage.distance_transform_edt(visible)
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    yy, xx = np.indices(alpha.shape)
    rgb = cell[..., :3].astype(np.float32)
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
    output = cell.copy()
    output[target] = 0
    removed = int(target.sum())
    # A thick background island between the legs can remain more than six
    # pixels inside the first silhouette. Peel only newly exposed neutral-gray
    # layers; brown boots and the pink tail fail the strict chroma gate.
    for _ in range(4):
        alpha = output[..., 3]
        visible = alpha > 0
        ys, xs = np.where(alpha > 32)
        if not len(ys):
            break
        inside = BASE.ndimage.distance_transform_edt(visible)
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
        "--action", action="append", choices=tuple(spec.name for spec in SPECS),
        help="rebuild only the named action; may be repeated",
    )
    parser.add_argument(
        "--refresh-cutouts", action="store_true",
        help="ignore cached selected cutouts for the chosen action(s)",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    selected_specs = tuple(spec for spec in SPECS if not selected or spec.name in selected)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    CUTOUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {
        spec.name: BASE.HELPER.decode_video(ROOT / "videos" / spec.video_name)
        for spec in selected_specs
    }
    model = None
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    effect_pixels: dict[str, dict[int, int]] = {spec.name: {} for spec in selected_specs}
    matte_edge_pixels: dict[str, dict[int, int]] = {spec.name: {} for spec in selected_specs}
    matte_alpha_pixels: dict[str, dict[int, int]] = {spec.name: {} for spec in selected_specs}

    for spec in selected_specs:
        frames, _ = decoded[spec.name]
        action_dir = CUTOUT_DIR / spec.name
        mask_dir = action_dir / "effect-masks"
        action_dir.mkdir(parents=True, exist_ok=True)
        if spec.name == "attacking":
            mask_dir.mkdir(parents=True, exist_ok=True)
        for index in spec.indices:
            cache_path = action_dir / f"source-f{index:03d}.png"
            meta_path = action_dir / f"source-f{index:03d}.json"
            if cache_path.exists() and not args.refresh_cutouts:
                rgba = np.asarray(Image.open(cache_path).convert("RGBA"))
                restored = 0
                edge_recolored = 0
                alpha_trimmed = 0
                if meta_path.exists():
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    restored = int(meta.get("attackEffectPixelsRestored", 0))
                    edge_recolored = int(meta.get("matteEdgePixelsRecolored", 0))
                    alpha_trimmed = int(meta.get("matteAlphaPixelsTrimmed", 0))
                print(f"[steel-shield] {spec.name} cached f{index}", flush=True)
            else:
                if model is None:
                    model = BASE.HELPER.get_model()
                rgba = BASE.cutout_rgba(frames[index], model)
                rgba, alpha_trimmed = trim_source_matte(frames[index], rgba)
                rgba, edge_recolored = replace_semtransparent_matte_rgb(frames[index], rgba)
                restored = 0
                if spec.name == "attacking" and 48 <= index <= 62:
                    rgba, effect_mask, restored = restore_attack_effect(frames[index], frames[47], rgba)
                    Image.fromarray(effect_mask, "L").save(mask_dir / f"source-f{index:03d}.png")
                rgba[rgba[..., 3] == 0, :3] = 0
                Image.fromarray(rgba, "RGBA").save(cache_path, optimize=True, compress_level=9)
                meta_path.write_text(
                    json.dumps({
                        "sourceFrame": index,
                        "matteAlphaPixelsTrimmed": alpha_trimmed,
                        "matteEdgePixelsRecolored": edge_recolored,
                        "attackEffectPixelsRestored": restored,
                    }, indent=2) + "\n",
                    encoding="utf-8",
                )
                print(f"[steel-shield] {spec.name} BiRefNet f{index} effect={restored}", flush=True)
            cutouts[(spec.name, index)] = rgba
            effect_pixels[spec.name][index] = restored
            matte_edge_pixels[spec.name][index] = edge_recolored
            matte_alpha_pixels[spec.name][index] = alpha_trimmed

    existing = None
    if selected and REPORT_PATH.exists():
        existing = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    source_body_heights = dict((existing or {}).get("sourceMedianUprightBodyHeightByAction", {}))
    scale_by_action = dict((existing or {}).get("fixedScaleByAction", {}))
    for spec in selected_specs:
        heights = []
        for index in spec.indices[:4]:
            _, y0, _, y1 = BASE.body_bbox(cutouts[(spec.name, index)])
            heights.append(y1 - y0 + 1)
        source_body_heights[spec.name] = float(np.median(heights))
        scale_by_action[spec.name] = TARGET_BODY_HEIGHT / source_body_heights[spec.name]

    report: dict[str, object] = existing or {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "assetOnly": True,
        "runtimeIntegration": False,
        "fixedTransformWithinEachAction": True,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "scaleContract": "one fixed scale per approved source camera; every action normalized to the same effective upright body height",
        "actions": {},
    }
    report["sourceMedianUprightBodyHeightByAction"] = source_body_heights
    report["fixedScaleByAction"] = scale_by_action

    for spec in selected_specs:
        rgba_frames = [cutouts[(spec.name, index)] for index in spec.indices]
        action_scale = scale_by_action[spec.name]
        frame_width, frame_height, anchor_x, anchor_y, foot_y = BASE.fixed_layout(rgba_frames, action_scale)
        if frame_width > 1024 or frame_height > 512:
            raise RuntimeError(f"{spec.name} needs unsupported cell {frame_width}x{frame_height}")
        cols = min(8, max(1, 8192 // frame_width))
        cells = [
            BASE.place_fixed(frame, action_scale, frame_width, frame_height, anchor_x, anchor_y, foot_y)
            for frame in rgba_frames
        ]
        ground_contact_removed = [0] * len(cells)
        if spec.name in {"running", "attacking"}:
            cleaned_cells = []
            for cell_index, cell in enumerate(cells):
                cell, ground_contact_removed[cell_index] = remove_ground_contact_matte(cell)
                cleaned_cells.append(cell)
            cells = cleaned_cells
        Image.fromarray(BASE.compose(cells, cols), "RGBA").save(
            SOURCE_DIR / f"{spec.name}.png", optimize=True, compress_level=9,
        )
        BASE.save_source_previews(spec, cells, PREVIEW_DIR)
        validation = BASE.HELPER.validate_cells(cells, spec.repeat)
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        final_count = len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1
        decoded_bytes = final_count * frame_width * frame_height * 4
        action_report: dict[str, object] = {
            "status": "user_approved_source_postprocessed_pre_rife",
            "configKey": spec.config_key,
            "source": f"videos/{spec.video_name}",
            "sourceFrameRate": decoded[spec.name][1],
            "sourceIndices": list(spec.indices),
            "sourceFrameCount": len(cells),
            "finalFrameCount": final_count,
            "frameWidth": frame_width,
            "frameHeight": frame_height,
            "cols": cols,
            "sourceRows": math.ceil(len(cells) / cols),
            "sourceSheetFrameRate": spec.source_sheet_fps,
            "runtimeFrameRate": spec.runtime_fps,
            "repeat": spec.repeat,
            "interpolationMode": "rife2x",
            "preserveVerticalMotionDuringRife": spec.preserve_vertical_motion,
            "footY": foot_y,
            "fixedSourceAnchor": {"x": anchor_x, "y": anchor_y},
            "sourceMedianUprightBodyHeight": source_body_heights[spec.name],
            "fixedActionScale": action_scale,
            "attackEffectPixelsRestoredByRawFrame": effect_pixels[spec.name],
            "matteAlphaPixelsTrimmedByRawFrame": matte_alpha_pixels[spec.name],
            "matteEdgePixelsRecoloredByRawFrame": matte_edge_pixels[spec.name],
            "groundContactMattePixelsRemovedBySourceSheetFrame": ground_contact_removed,
            "decodedBytes": decoded_bytes,
            "decodedMiB": decoded_bytes / (1024 ** 2),
            "sheet": str((SOURCE_DIR / f"{spec.name}.png").relative_to(ROOT)).replace("\\", "/"),
            "preview": str((PREVIEW_DIR / f"{spec.name}-source.gif").relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str((PREVIEW_DIR / f"{spec.name}-source-contact.png").relative_to(ROOT)).replace("\\", "/"),
            "validation": validation,
        }
        if spec.name == "running":
            action_report["loopSelection"] = {
                "startInclusive": 40, "endExclusive": 61, "seamReference": 61,
                "periodSeconds": 21 / 24,
            }
        if spec.name == "attacking":
            action_report["releaseRawSourceFrame"] = 48
            action_report["releaseSourceSheetIndex"] = spec.indices.index(48)
            action_report["releaseRifeOutputIndex"] = spec.indices.index(48) * 2
            action_report["releaseDelayMs"] = spec.indices.index(48) * 2 / spec.runtime_fps * 1000
        if spec.name == "dying":
            action_report["finalCorpseRawSourceFrame"] = 88
            action_report["finalCorpseOutputIndex"] = final_count - 1
        report["actions"][spec.name] = action_report

    total_decoded_bytes = sum(int(action["decodedBytes"]) for action in report["actions"].values())
    report["totalDecodedBytes"] = total_decoded_bytes
    report["totalDecodedMiB"] = total_decoded_bytes / (1024 ** 2)
    report["crowdTargetMiB"] = 32
    report["admissionMiB"] = 64
    report["withinTarget"] = total_decoded_bytes <= 32 * 1024 ** 2
    report["withinAdmission"] = total_decoded_bytes <= 64 * 1024 ** 2
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if not report["withinAdmission"]:
        raise RuntimeError(f"Decoded sprite budget {report['totalDecodedMiB']:.2f} MiB exceeds 64 MiB")


if __name__ == "__main__":
    main()
