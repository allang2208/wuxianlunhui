#!/usr/bin/env python3
"""Build approved attack/death transparent source sheets before RIFE."""

from __future__ import annotations

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
BASE_BUILDER = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("industrial_recon_one_shot_base", BASE_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_BUILDER}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
FRAME_DIR = OUT / "selected-cutouts"
REPORT_PATH = OUT / "approved-one-shot-source-report.json"


@dataclass(frozen=True)
class OneShotSpec:
    action: str
    video: str
    indices: tuple[int, ...]
    frame_rate: float
    horizontal_mode: str
    vertical_mode: str


SPECS = (
    OneShotSpec(
        "attacking",
        "attacking-doubao-v03-receiver-visible.mp4",
        (
            0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 38, 40, 41, 42, 44, 47,
            50, 53, 56, 59, 62, 65, 68, 71, 74, 77, 80, 83, 86, 89, 92,
            95, 98, 102, 106, 110, 114, 118, 120,
        ),
        12.0,
        "center-body",
        "body-feet",
    ),
    OneShotSpec(
        "dying",
        "dying-doubao-v03-sling-retained.mp4",
        (
            0, 4, 8, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45,
            48, 51, 54, 57, 60, 64, 68, 72, 80, 90, 105, 120,
        ),
        12.0,
        "preserve-source",
        "content-ground",
    ),
)


def restore_forward_warm_effect(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Restore a warm muzzle flash immediately ahead of the current rifle alpha."""
    alpha = rgba[..., 3]
    _, body_y0, _, body_y1 = BASE.opened_body_bbox(rgba)
    _, _, alpha_x1, _ = BASE.BASE.alpha_bbox(rgba)
    body_h = body_y1 - body_y0 + 1
    yy, xx = np.indices(alpha.shape)
    distance_from_white = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    roi = (
        (xx >= alpha_x1 - 12)
        & (xx <= alpha_x1 + 180)
        & (yy >= body_y0)
        & (yy <= body_y0 + round(body_h * 0.72))
    )
    work = rgb.astype(np.int16)
    warm_seed = (
        (work[..., 0] > 165)
        & (work[..., 1] > 55)
        & (work[..., 0] - work[..., 2] > 45)
        & (work[..., 1] - work[..., 2] > 10)
        & roi
    )
    if not warm_seed.any():
        return rgba, 0
    candidate = cv2.morphologyEx(
        warm_seed.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8)
    )
    candidate = cv2.dilate(candidate, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    effect = np.zeros_like(candidate)
    for component in range(1, count):
        component_mask = labels == component
        if int(stats[component, cv2.CC_STAT_AREA]) >= 12 and (component_mask & warm_seed).any():
            effect[component_mask] = 1
    effect_alpha = effect.astype(np.float32) * np.clip(
        (distance_from_white - 10.0) * 12.0, 0, 255
    )
    new_alpha = np.maximum(alpha, np.clip(effect_alpha, 0, 255).astype(np.uint8))
    added = new_alpha > alpha
    output = rgba.copy()
    output[..., :3][added] = rgb[added]
    output[..., 3] = new_alpha
    output[output[..., 3] == 0, :3] = 0
    return output, int(added.sum())


def main() -> None:
    loop_report = json.loads((OUT / "approved-loop-source-report.json").read_text(encoding="utf-8"))
    fixed_scale = float(loop_report["fixedScaleAcrossApprovedActions"])
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {
        spec.action: BASE.BASE.decode_video(ROOT / "videos" / spec.video)
        for spec in SPECS
    }
    model = BASE.BASE.get_model()
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    cleanup: dict[str, dict[int, dict[str, int]]] = {spec.action: {} for spec in SPECS}

    for spec in SPECS:
        action_dir = FRAME_DIR / spec.action
        action_dir.mkdir(parents=True, exist_ok=True)
        frames = decoded[spec.action][0]
        for source_index in spec.indices:
            rgb = frames[source_index]
            rgba = BASE.BASE.cutout_rgba(rgb, model)
            rgba, detached_removed = BASE.strip_small_cutout_components(rgba)
            warm_added = 0
            if spec.action == "attacking":
                rgba, warm_added = restore_forward_warm_effect(rgb, rgba)
            rgba[rgba[..., 3] == 0, :3] = 0
            cutouts[(spec.action, source_index)] = rgba
            cleanup[spec.action][source_index] = {
                "detachedPixelsRemoved": detached_removed,
                "muzzleEffectPixelsRestored": warm_added,
            }
            Image.fromarray(rgba, "RGBA").save(action_dir / f"source-f{source_index:03d}.png")
            print(f"[industrial-recon-source] {spec.action} BiRefNet f{source_index}", flush=True)

    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "industrial_recon_rifleman",
        "assetOnly": True,
        "runtimeIntegration": False,
        "fixedScaleFromApprovedIdle": fixed_scale,
        "frameHeight": BASE.FRAME_HEIGHT,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cutouts[(spec.action, index)] for index in spec.indices]
        frame_width, reference_anchor = BASE.choose_width(
            rgba_frames, fixed_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.action} needs unsupported frame width {frame_width}")
        cells = [
            BASE.place_cell(
                rgba,
                fixed_scale,
                frame_width,
                spec.horizontal_mode,
                spec.vertical_mode,
                reference_anchor,
            )
            for rgba in rgba_frames
        ]
        sheet_path = SOURCE_DIR / f"{spec.action}.png"
        Image.fromarray(BASE.compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        preview_spec = BASE.ActionSpec(
            spec.action,
            spec.video,
            spec.indices,
            spec.frame_rate,
            0,
            spec.horizontal_mode,
            spec.vertical_mode,
        )
        BASE.save_previews(preview_spec, cells, PREVIEW_DIR)
        validation = BASE.BASE.validate_cells(cells, 0)
        validation.update(BASE.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.action] = {
            "status": "assistant_source_review_passed_postprocessed_pre_rife",
            "source": f"videos/{spec.video}",
            "sourceFrameRate": decoded[spec.action][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": BASE.FRAME_HEIGHT,
            "cols": BASE.COLS,
            "rows": math.ceil(len(cells) / BASE.COLS),
            "frameRate": spec.frame_rate,
            "repeat": 0,
            "mode": "one-shot",
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
            "preview": str((PREVIEW_DIR / f"{spec.action}.gif").relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str((PREVIEW_DIR / f"{spec.action}-contact.png").relative_to(ROOT)).replace("\\", "/"),
            "cleanup": cleanup[spec.action],
            "validation": validation,
        }

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
