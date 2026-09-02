#!/usr/bin/env python3
"""Build five approved anti-tank rifleman source sheets before RIFE.

This is asset-only postprocessing.  It preserves authored source keys, removes
only positively identified Doubao tail pixels, strips the detached grenade from
the actor after release, restores warm muzzle flash pixels, and records the raw
source-to-sheet event mapping.
"""

from __future__ import annotations

import importlib.util
import json
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_PATH = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
TAIL_PATH = ROOT / "diagnose-tail-cleanup-v02.py"


def import_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = import_module(BASE_PATH, "anti_tank_source_base")
TAIL = import_module(TAIL_PATH, "anti_tank_tail_cleanup")

POST = ROOT / "postprocess"
SOURCE_DIR = POST / "source-sheets-pre-rife"
PREVIEW_DIR = POST / "previews" / "source"
FRAME_DIR = POST / "selected-cutouts"
REPORT_PATH = POST / "approved-source-report.json"


@dataclass(frozen=True)
class ActionSpec:
    action: str
    video: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str
    mode: str


def with_forced(base: tuple[int, ...], forced: tuple[int, ...]) -> tuple[int, ...]:
    return tuple(sorted(set([*base, *forced])))


def restore_forward_warm_effect(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Restore muzzle flash that BiRefNet can mistake for white background."""
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
    # Never use generic non-white pixels here: the source background is light
    # gray and would form a large connected rectangle.  Only the warm flame
    # itself may restore alpha; smoke remains excluded by design.
    candidate = warm_seed.astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8))
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


def remove_tail(rgba: np.ndarray, action: str) -> tuple[np.ndarray, int]:
    candidate = TAIL.conservative_tail_candidate(
        rgba, include_disconnected_segments=True
    )
    output = rgba.copy()
    output[candidate] = 0
    return output, int(candidate.sum())


def keep_largest_actor_component(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove detached thrown-grenade pixels while retaining the actor/weapon."""
    foreground = (rgba[..., 3] > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        return rgba, 0
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    output = rgba.copy()
    removed = int(np.count_nonzero((rgba[..., 3] > 0) & ~keep))
    output[~keep] = 0
    return output, removed


def metrics(cells: list[np.ndarray]) -> dict[str, object]:
    data = BASE.body_metrics(cells)
    data["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    return data


def main() -> None:
    video_names = {
        "idle": "idle-doubao-v02-no-fire.mp4",
        "running": "running-doubao-v01.mp4",
        "attacking": "attacking-doubao-v01.mp4",
        "grenade_throw": "grenade-throw-doubao-v01.mp4",
        "dying": "dying-doubao-v01.mp4",
    }
    decoded = {
        action: BASE.BASE.decode_video(ROOT / "videos" / video)
        for action, video in video_names.items()
    }
    specs = (
        ActionSpec("idle", video_names["idle"], tuple(range(52, 89, 2)), 12.0, -1, "center-body", "body-feet", "loop"),
        ActionSpec("running", video_names["running"], tuple(range(39, 63)), 24.0, -1, "center-body", "body-feet", "loop"),
        ActionSpec(
            "attacking", video_names["attacking"],
            with_forced(
                BASE.BASE.visual_resample_indices(decoded["attacking"][0], 8, 110, 28),
                (31, 34, 35, 36, 40, 58, 59, 60, 76, 81, 96, 109),
            ),
            12.0, 0, "center-body", "body-feet", "one-shot",
        ),
        ActionSpec(
            "grenade_throw", video_names["grenade_throw"],
            with_forced(
                BASE.BASE.visual_resample_indices(decoded["grenade_throw"][0], 0, 118, 32),
                (35, 58, 66, 68, 70, 71, 72, 73, 74, 76, 80, 89, 101, 117),
            ),
            12.0, 0, "center-body", "body-feet", "one-shot",
        ),
        ActionSpec(
            "dying", video_names["dying"],
            with_forced(
                BASE.BASE.visual_resample_indices(decoded["dying"][0], 8, 81, 20),
                (12, 15, 19, 35, 50, 54, 62, 70, 74, 80),
            ),
            12.0, 0, "preserve-source", "content-ground", "one-shot",
        ),
    )

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    cleanup: dict[str, dict[int, dict[str, int]]] = {spec.action: {} for spec in specs}

    for spec in specs:
        action_dir = FRAME_DIR / spec.action
        action_dir.mkdir(parents=True, exist_ok=True)
        frames = decoded[spec.action][0]
        for source_index in spec.indices:
            rgb = frames[source_index]
            rgba = BASE.BASE.cutout_rgba(rgb, model)
            warm_added = 0
            if spec.action == "attacking":
                rgba, warm_added = restore_forward_warm_effect(rgb, rgba)
            rgba, tail_removed = remove_tail(rgba, spec.action)
            grenade_removed = 0
            if spec.action == "grenade_throw" and source_index >= 72:
                rgba, grenade_removed = keep_largest_actor_component(rgba)
            rgba[rgba[..., 3] == 0, :3] = 0
            cache[(spec.action, source_index)] = rgba
            cleanup[spec.action][source_index] = {
                "tailPixelsRemoved": tail_removed,
                "detachedGrenadePixelsRemoved": grenade_removed,
                "muzzleEffectPixelsRestored": warm_added,
            }
            Image.fromarray(rgba, "RGBA").save(action_dir / f"source-f{source_index:03d}.png")
            print(f"[anti-tank-source] {spec.action} BiRefNet f{source_index}", flush=True)

    idle_heights = []
    for source_index in specs[0].indices:
        _, y0, _, y1 = BASE.opened_body_bbox(cache[("idle", source_index)])
        idle_heights.append(y1 - y0 + 1)
    reference_body_height = float(statistics.median(idle_heights))
    fixed_scale = BASE.TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "anti_tank_rifleman",
        "assetOnly": True,
        "runtimeIntegration": False,
        "bodyScaleReference": "hamster ranger/sniper/industrial recon route standard",
        "frameHeight": BASE.FRAME_HEIGHT,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "referenceIdleBodyHeightMedian": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "tailCleanupPolicy": "tail-colored thin segments are eligible only when an exposed tail tip exists; the morphologically opened thick body/clothing/boot core plus a 3px edge guard is never removed; no broad body wedge is used",
        "grenadeReleaseRawFrame": 72,
        "actions": {},
    }

    for spec in specs:
        rgba_frames = [cache[(spec.action, index)] for index in spec.indices]
        frame_width, reference_anchor = BASE.choose_width(
            rgba_frames, fixed_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.action} needs unsupported frame width {frame_width}")
        cells = [
            BASE.place_cell(
                rgba, fixed_scale, frame_width, spec.horizontal_mode,
                spec.vertical_mode, reference_anchor,
            )
            for rgba in rgba_frames
        ]
        Image.fromarray(BASE.compose(cells), "RGBA").save(
            SOURCE_DIR / f"{spec.action}.png", optimize=True, compress_level=9
        )
        preview_spec = BASE.ActionSpec(
            spec.action, spec.video, spec.indices, spec.frame_rate, spec.repeat,
            spec.horizontal_mode, spec.vertical_mode,
        )
        BASE.save_previews(preview_spec, cells, PREVIEW_DIR)
        validation = BASE.BASE.validate_cells(cells, spec.repeat)
        validation.update(metrics(cells))
        action_report: dict[str, object] = {
            "status": "user_approved_source_postprocessed_pre_rife",
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
            "repeat": spec.repeat,
            "mode": spec.mode,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "cleanupByRawSourceFrame": cleanup[spec.action],
            "sheet": str((SOURCE_DIR / f"{spec.action}.png").relative_to(ROOT)).replace("\\", "/"),
            "preview": str((PREVIEW_DIR / f"{spec.action}.gif").relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str((PREVIEW_DIR / f"{spec.action}-contact.png").relative_to(ROOT)).replace("\\", "/"),
            "validation": validation,
        }
        if spec.action == "grenade_throw":
            release_source_index = spec.indices.index(72)
            action_report["releaseRawSourceFrame"] = 72
            action_report["releaseSourceSheetIndex"] = release_source_index
            action_report["releaseRifeOutputIndex"] = release_source_index * 2
        report["actions"][spec.action] = action_report

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
