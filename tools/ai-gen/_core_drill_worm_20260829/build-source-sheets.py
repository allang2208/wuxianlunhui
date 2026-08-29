#!/usr/bin/env python3
"""Build normalized transparent source sheets for the accepted rock-core drill worm videos.

Scale is based on the maximum local body thickness (distance-transform diameter),
not the long alpha width or action pose. Every action uses one fixed transform from
the source video coordinate system so the authored grinder lunge, dive, emergence,
and death trajectory remain intact. The burrow clip is deliberately split into an
enter and exit sheet; the truly hidden interval belongs to runtime state, not a
fake dirt-hole sprite. Burrow cleanup must never use a fixed horizontal clear band:
the legs and lower abdomen occupy the same source rows as the generated ground hole.
"""

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
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = (
    REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825"
    / "build-halberdier-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("core_drill_worm_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


FRAME_HEIGHT = 640
GROUND_Y = 550
TARGET_LOCAL_BODY_THICKNESS = 180.0
MARGIN = 24
ALPHA_CUTOFF = 24
RELIABLE_ALPHA = 224
MAX_TEXTURE_EDGE = 8192

SOURCES = {
    "idle": "idle-doubao-v01.mp4",
    "crawling": "crawling-doubao-v01.mp4",
    "grinder_attack": "grinder-attack-doubao-v02-fixed-mouth.mp4",
    "burrow": "burrow-ambush-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}


@dataclass(frozen=True)
class ActionSpec:
    name: str
    source_key: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    reference_index: int = 0


SPECS = (
    ActionSpec("idle", "idle", tuple(range(0, 120, 4)), 6.0, -1),
    ActionSpec("crawling", "crawling", tuple(range(0, 120, 4)), 6.0, -1),
    ActionSpec("grinder_attack", "grinder_attack", tuple(range(0, 121, 4)), 6.0, 0),
    ActionSpec("burrow_enter", "burrow", tuple(range(0, 61, 4)), 6.0, 0),
    ActionSpec("burrow_exit", "burrow", tuple(range(84, 121, 4)), 6.0, 0),
    ActionSpec("dying", "dying", tuple(range(0, 121, 4)), 6.0, 0),
)


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


def keep_largest_component(rgba: np.ndarray) -> np.ndarray:
    foreground = (rgba[..., 3] > ALPHA_CUTOFF).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no visible worm component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate(
        (labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)
    ) > 0
    out = rgba.copy()
    out[~keep, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return clean_edge_rgb(out)


def cutout_action_frame(source_key: str, source_index: int, rgb: np.ndarray, model) -> np.ndarray:
    rgba = BASE.cutout_rgba(rgb, model)
    # The generated hole/dirt is disconnected from the worm in the accepted source,
    # so primary-component filtering removes it without touching anatomy. Do not
    # clear a fixed Y band here: that previously deleted the abdomen and all six legs.
    return keep_largest_component(rgba)


def local_body_thickness(rgba: np.ndarray) -> float:
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    diameter = float(distance.max(initial=0.0) * 2.0)
    if diameter < 20:
        raise RuntimeError(f"Implausible local body thickness: {diameter}")
    return diameter


def round_width(value: float) -> int:
    return max(512, int(math.ceil(value / 128.0) * 128))


def choose_frame_width(
    rgba_frames: list[np.ndarray], scale: float, reference_x: float
) -> int:
    half_span = 0.0
    for rgba in rgba_frames:
        x0, _, x1, _ = BASE.alpha_bbox(rgba)
        half_span = max(
            half_span,
            (reference_x - x0) * scale,
            (x1 + 1 - reference_x) * scale,
        )
    width = round_width(half_span * 2 + MARGIN * 2)
    if width > 2048:
        raise RuntimeError(f"Required frame width {width} exceeds 2048px formal-cell limit")
    return width


def place_cell(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    reference_x: float,
    reference_ground_y: int,
) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    ).copy()
    resized[resized[..., 3] == 0, :3] = 0
    offset_x = round(frame_width / 2 + (x0 - reference_x) * scale)
    offset_y = round(GROUND_Y + (y0 - reference_ground_y) * scale)
    if (
        offset_x < MARGIN
        or offset_y < MARGIN
        or offset_x + width > frame_width - MARGIN
        or offset_y + height > FRAME_HEIGHT - MARGIN
    ):
        raise RuntimeError(
            f"Placement clips safety margin: {width}x{height} at {offset_x},{offset_y} "
            f"inside {frame_width}x{FRAME_HEIGHT}"
        )
    cell = np.zeros((FRAME_HEIGHT, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    frame_width = cells[0].shape[1]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * FRAME_HEIGHT, cols * frame_width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[
            row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
            col * frame_width:(col + 1) * frame_width,
        ] = cell
    return sheet


def thickness_metrics(cells: list[np.ndarray]) -> dict[str, float]:
    values = [local_body_thickness(cell) for cell in cells]
    return {
        "localBodyThicknessMin": float(min(values)),
        "localBodyThicknessMedian": float(np.median(values)),
        "localBodyThicknessMax": float(max(values)),
    }


def main() -> None:
    videos = {
        key: BASE.decode_video(ROOT / "videos" / filename)
        for key, filename in SOURCES.items()
    }
    for key, (frames, fps) in videos.items():
        if len(frames) != 121 or abs(fps - 24.0) > 0.01:
            raise RuntimeError(f"Unexpected {key} source: {len(frames)} frames at {fps}")

    frame_dir = ROOT / "frames" / "birefnet-source"
    frame_dir.mkdir(parents=True, exist_ok=True)
    required = {
        (spec.source_key, source_index)
        for spec in SPECS
        for source_index in (*spec.indices, spec.reference_index)
    }
    cache: dict[tuple[str, int], np.ndarray] = {}
    model = None
    for source_key, source_index in sorted(required):
        # Burrow v1 caches contain the old fixed-Y crop. Use a new cache stem so the
        # corrected full-body cutouts are regenerated without deleting prior evidence.
        cache_stem = "burrow-full-v2" if source_key == "burrow" else source_key
        cached_path = frame_dir / f"{cache_stem}-f{source_index:03d}.png"
        if cached_path.exists():
            cache[(source_key, source_index)] = np.asarray(
                Image.open(cached_path).convert("RGBA")
            ).copy()
            print(f"[core-drill-worm] {source_key} cache f{source_index}", flush=True)
            continue
        if model is None:
            model = BASE.get_model()
        rgb = videos[source_key][0][source_index]
        rgba = cutout_action_frame(source_key, source_index, rgb, model)
        cache[(source_key, source_index)] = rgba
        Image.fromarray(rgba, "RGBA").save(cached_path, optimize=True, compress_level=9)
        print(f"[core-drill-worm] {source_key} BiRefNet f{source_index}", flush=True)

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "pipeline": "accepted Doubao source -> BiRefNet-general -> primary-component cleanup -> fixed per-action source-coordinate transform",
        "scaleReference": "maximum local body thickness from alpha distance transform; length, legs and extreme poses excluded",
        "targetLocalBodyThickness": TARGET_LOCAL_BODY_THICKNESS,
        "frameHeight": FRAME_HEIGHT,
        "groundY": GROUND_Y,
        "cleanup": {
            "all": "remove regenerated white-floor shadow and Doubao corner marks by BiRefNet plus primary-component filtering",
            "burrow": "preserve the complete worm and remove disconnected dirt/hole via primary-component filtering; formal output is split into enter/exit and omits only the fully hidden interval",
        },
        "actions": {},
    }

    for spec in SPECS:
        reference = cache[(spec.source_key, spec.reference_index)]
        reference_bbox = BASE.alpha_bbox(reference)
        reference_x = (reference_bbox[0] + reference_bbox[2]) / 2.0
        reference_ground_y = reference_bbox[3]
        source_thickness = local_body_thickness(reference)
        scale = TARGET_LOCAL_BODY_THICKNESS / source_thickness
        rgba_frames = [cache[(spec.source_key, index)] for index in spec.indices]
        frame_width = choose_frame_width(rgba_frames, scale, reference_x)
        cols = min(8, max(1, MAX_TEXTURE_EDGE // frame_width))
        cells = [
            place_cell(rgba, scale, frame_width, reference_x, reference_ground_y)
            for rgba in rgba_frames
        ]
        Image.fromarray(compose(cells, cols), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        preview_spec = HELPER.ActionSpec(
            spec.name, spec.indices, spec.frame_rate, spec.repeat,
            "preserve-source", "content-ground",
        )
        old_height = HELPER.FRAME_HEIGHT
        HELPER.FRAME_HEIGHT = FRAME_HEIGHT
        try:
            HELPER.save_previews(preview_spec, cells, preview_dir)
        finally:
            HELPER.FRAME_HEIGHT = old_height
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(thickness_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.source_key]}",
            "sourceIndices": list(spec.indices),
            "referenceSourceFrame": spec.reference_index,
            "sourceReferenceLocalBodyThickness": source_thickness,
            "cameraNormalizationScale": scale,
            "frameCount": len(cells),
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": cols,
            "rows": math.ceil(len(cells) / cols),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": "fixed-source-coordinate",
            "verticalMode": "fixed-source-coordinate",
            "validation": validation,
        }

    report["actions"]["idle"]["naturalCycle"] = {
        "sourceFrameRange": [0, 116], "closureSourceFrame": 120
    }
    report["actions"]["crawling"]["naturalCycle"] = {
        "sourceFrameRange": [0, 116], "closureSourceFrame": 120
    }
    report["actions"]["grinder_attack"]["contactMapping"] = {
        "sourceVideoFrame": 68,
        "sourceSheetFrameZeroBased": 17,
        "rifeOutputFrameZeroBased": 34,
    }
    report["actions"]["burrow_enter"]["hiddenTransitionAfterSourceFrame"] = 60
    report["actions"]["burrow_exit"]["hiddenTransitionBeforeSourceFrame"] = 84
    report["actions"]["dying"]["stableCorpseSourceFrame"] = 120

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
