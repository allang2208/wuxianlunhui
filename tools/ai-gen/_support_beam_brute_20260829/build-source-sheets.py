#!/usr/bin/env python3
"""Build normalized transparent source sheets for the support-beam brute.

The long beam is excluded from scale measurement: every action targets the same
345px effective body height in a 640px cell with a y=476 foot line.  Camera
scale stays fixed inside each action, preserving the authored attack/death
trajectory.  Component cleanup removes the incoming break projectile, soft
smoke/debris, and the detached attack-v02 wood block without shortening the
held beam or deleting the two deliberately discarded beam halves.
"""

from __future__ import annotations

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
REPO = ROOT.parents[2]
HELPER_PATH = (
    REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825"
    / "build-halberdier-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("support_brute_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


HELPER.FRAME_HEIGHT = 640
HELPER.FEET_Y = 476
HELPER.TARGET_BODY_HEIGHT = 345
HELPER.BODY_OPEN_KERNEL_SOURCE = 31
HELPER.BODY_OPEN_KERNEL_OUTPUT = 15
HELPER.COLS = 8
HELPER.MARGIN = 20

SOURCES = {
    "armed_idle": "idle-doubao-v01.mp4",
    "armed_walk": "moving-doubao-v01.mp4",
    "beam_break": "break-discard-doubao-v01.mp4",
    "armed_attack": "attacking-with-beam-doubao-v02-safe-frame.mp4",
    "unarmed_idle": "break-discard-doubao-v01.mp4",
    "unarmed_walk": "moving-unarmed-doubao-v01.mp4",
    "unarmed_attack": "attacking-unarmed-doubao-v01.mp4",
    "death": "dying-unarmed-doubao-v02-left-back.mp4",
}

SPECS = (
    HELPER.ActionSpec("armed_idle", tuple(range(0, 120, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("armed_walk", tuple(range(40, 93, 4)), 6.0, -1, "center-body", "body-feet"),
    # f8 contains the incoming projectile; f24-f32 contain connected impact
    # smoke/debris.  They are deliberately skipped rather than masked through
    # the actor/beam silhouette.  RIFE bridges clean intact f20 to clean broken
    # f36 without baking either foreign effect into the character sheet.
    HELPER.ActionSpec("beam_break", (0, 4, 12, 16, 20, *range(36, 121, 4)), 6.0, 0, "preserve-source", "body-feet"),
    HELPER.ActionSpec("armed_attack", tuple(range(0, 121, 4)), 6.0, 0, "preserve-source", "body-feet"),
    HELPER.ActionSpec("unarmed_idle", (120,), 1.0, 0, "center-body", "body-feet"),
    HELPER.ActionSpec("unarmed_walk", tuple(range(31, 72, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("unarmed_attack", tuple(range(0, 121, 4)), 6.0, 0, "preserve-source", "body-feet"),
    HELPER.ActionSpec("death", tuple(range(0, 121, 4)), 6.0, 0, "preserve-source", "content-ground"),
)

ALPHA_CUTOFF = 24
RELIABLE_ALPHA = 224


def clean_edge_rgb(rgba: np.ndarray) -> np.ndarray:
    cleaned = rgba.copy()
    alpha = cleaned[..., 3]
    alpha[alpha <= ALPHA_CUTOFF] = 0
    visible = alpha > 0
    reliable = alpha >= RELIABLE_ALPHA
    edge = visible & ~reliable
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        cleaned[..., :3][edge] = cleaned[nearest[0][edge], nearest[1][edge], :3]
    cleaned[..., 3] = alpha
    cleaned[~visible, :3] = 0
    return cleaned


def component_data(rgba: np.ndarray):
    foreground = (rgba[..., 3] > ALPHA_CUTOFF).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no visible actor component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return count, labels, stats, largest


def filter_primary_component(rgba: np.ndarray) -> np.ndarray:
    """Keep only the connected actor/held-beam silhouette."""
    _, labels, _, largest = component_data(rgba)
    keep = cv2.dilate(
        (labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)
    ) > 0
    out = rgba.copy()
    out[~keep, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return clean_edge_rgb(out)


def filter_break_components(rgba: np.ndarray, source_index: int) -> np.ndarray:
    """Keep actor plus intentional large beam halves, never the hit projectile."""
    count, labels, stats, largest = component_data(rgba)
    keep = labels == largest
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    actor_center_x = lx + lw / 2
    actor_center_y = ly + lh / 2

    # Before the impact, every detached object is foreign.  During/after the
    # break only large opaque wood pieces close to the actor are retained.
    if source_index >= 24:
        max_dx = 300 if source_index >= 72 else 150
        max_dy = 190
        for label in range(1, count):
            if label == largest:
                continue
            area = int(stats[label, cv2.CC_STAT_AREA])
            if area < 650:
                continue
            component = labels == label
            strong_ratio = float(np.count_nonzero(rgba[..., 3][component] >= 128)) / area
            if strong_ratio < 0.35:
                continue
            x = int(stats[label, cv2.CC_STAT_LEFT])
            y = int(stats[label, cv2.CC_STAT_TOP])
            w = int(stats[label, cv2.CC_STAT_WIDTH])
            h = int(stats[label, cv2.CC_STAT_HEIGHT])
            center_x = x + w / 2
            center_y = y + h / 2
            if abs(center_x - actor_center_x) <= max_dx and abs(center_y - actor_center_y) <= max_dy:
                keep |= component

    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    out = rgba.copy()
    out[~keep, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return clean_edge_rgb(out)


def cutout_action_frame(action: str, source_index: int, rgb: np.ndarray, model) -> np.ndarray:
    rgba = BASE.cutout_rgba(rgb, model)
    if action == "beam_break":
        return filter_break_components(rgba, source_index)
    return filter_primary_component(rgba)


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    frame_width = cells[0].shape[1]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * HELPER.FRAME_HEIGHT, cols * frame_width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[
            row * HELPER.FRAME_HEIGHT:(row + 1) * HELPER.FRAME_HEIGHT,
            col * frame_width:(col + 1) * frame_width,
        ] = cell
    return sheet


def choose_asymmetric_preserved_width(
    rgba_frames: list[np.ndarray], scale: float
) -> tuple[int, float]:
    """Keep global X trajectory without wasting a mirrored empty half-frame."""
    min_x = min(BASE.alpha_bbox(rgba)[0] for rgba in rgba_frames)
    max_x = max(BASE.alpha_bbox(rgba)[2] + 1 for rgba in rgba_frames)
    frame_width = HELPER.round_width((max_x - min_x) * scale + HELPER.MARGIN * 2)
    reference_anchor = min_x + (frame_width / 2 - HELPER.MARGIN) / scale
    return frame_width, reference_anchor


def main() -> None:
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    for action, (frames, fps) in videos.items():
        if len(frames) != 121 or abs(fps - 24.0) > 0.01:
            raise RuntimeError(f"Unexpected {action} source: {len(frames)} frames at {fps}")

    frame_dir = ROOT / "frames" / "birefnet-source"
    frame_dir.mkdir(parents=True, exist_ok=True)
    model = None
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in SPECS:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            key = (spec.name, source_index)
            cached_path = frame_dir / f"{spec.name}-f{source_index:03d}.png"
            if cached_path.exists():
                cache[key] = np.asarray(Image.open(cached_path).convert("RGBA")).copy()
                print(f"[support-beam-brute] {spec.name} cache f{source_index}", flush=True)
            else:
                if model is None:
                    model = BASE.get_model()
                cache[key] = cutout_action_frame(spec.name, source_index, source_frames[source_index], model)
                Image.fromarray(cache[key], "RGBA").save(
                    cached_path, optimize=True, compress_level=9
                )
                print(f"[support-beam-brute] {spec.name} BiRefNet f{source_index}", flush=True)

    source_body_heights: dict[str, int] = {}
    scale_by_action: dict[str, float] = {}
    for spec in SPECS:
        reference = cache[(spec.name, spec.indices[0])]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        body_height = body_y1 - body_y0 + 1
        source_body_heights[spec.name] = body_height
        scale_by_action[spec.name] = HELPER.TARGET_BODY_HEIGHT / body_height

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "pipeline": "accepted Doubao source -> BiRefNet-general -> artifact filtering -> fixed per-action effective-body scale",
        "bodyScaleReference": "miner-zombie effective body height x 1.25",
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "sourceBodyHeightByAction": source_body_heights,
        "cameraNormalizationScaleByAction": scale_by_action,
        "cleanup": {
            "beamBreak": "incoming projectile and soft smoke/small debris removed; two large discarded beam halves retained",
            "armedAttack": "detached wood block removed; connected held beam retained",
        },
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        action_scale = scale_by_action[spec.name]
        if spec.name == "armed_attack":
            frame_width, reference_anchor = choose_asymmetric_preserved_width(rgba_frames, action_scale)
        else:
            frame_width, reference_anchor = HELPER.choose_width(rgba_frames, action_scale, spec.horizontal_mode)
        if frame_width > 1536:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cols = min(HELPER.COLS, max(1, 8192 // frame_width))
        cells = [
            HELPER.place_cell(
                rgba, action_scale, frame_width, spec.horizontal_mode,
                spec.vertical_mode, reference_anchor,
            )
            for rgba in rgba_frames
        ]
        for source_index, rgba in zip(spec.indices, rgba_frames):
            Image.fromarray(rgba, "RGBA").save(
                frame_dir / f"{spec.name}-f{source_index:03d}.png",
                optimize=True, compress_level=9,
            )
        Image.fromarray(compose(cells, cols), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.name]}",
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "frameWidth": frame_width,
            "frameHeight": HELPER.FRAME_HEIGHT,
            "cols": cols,
            "rows": math.ceil(len(cells) / cols),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) if len(cells) == 1 else (
                len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1
            ),
            "expectedRifeFrameRate": spec.frame_rate if len(cells) == 1 else spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    report["actions"]["armed_idle"]["naturalCycle"] = {"sourceFrameRange": [0, 116], "closureSourceFrame": 120}
    report["actions"]["armed_walk"]["naturalCycle"] = {"sourceFrameRange": [40, 92], "analyzerScore": 0.036}
    report["actions"]["unarmed_walk"]["naturalCycle"] = {"sourceFrameRange": [31, 71], "analyzerScore": 0.063}
    report["actions"]["armed_attack"]["contactMapping"] = {"sourceVideoFrame": 60, "sourceSheetFrameZeroBased": 15, "rifeOutputFrameZeroBased": 30}
    report["actions"]["unarmed_attack"]["contactMapping"] = {"sourceVideoFrame": 72, "sourceSheetFrameZeroBased": 18, "rifeOutputFrameZeroBased": 36}
    report["actions"]["death"]["stableCorpseSourceFrame"] = 120

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
