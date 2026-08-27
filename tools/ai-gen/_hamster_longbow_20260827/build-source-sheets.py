#!/usr/bin/env python3
"""Build normalized transparent hamster-longbow source sheets from Doubao videos."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825" / "build-halberdier-sheets.py"
SPEC = importlib.util.spec_from_file_location("longbow_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE

SOURCES = {
    "idle": "idle-doubao-v01.mp4",
    "running": "moving-doubao-v01.mp4",
    "attacking": "attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}
MATTE_ALPHA_CUTOFF = 24
MATTE_RELIABLE_ALPHA = 224


def uniform_indices(start: int, end_inclusive: int, step: int) -> tuple[int, ...]:
    return tuple(range(start, end_inclusive + 1, step))


def clean_white_matte_edges(rgba: np.ndarray) -> np.ndarray:
    """Trim extraction tails and replace white-matte fringe RGB from the subject."""
    cleaned = rgba.copy()
    alpha = cleaned[..., 3]
    alpha[alpha <= MATTE_ALPHA_CUTOFF] = 0
    visible = alpha > 0
    reliable = alpha >= MATTE_RELIABLE_ALPHA
    edge = visible & ~reliable
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        cleaned[..., :3][edge] = cleaned[nearest[0][edge], nearest[1][edge], :3]
    cleaned[..., 3] = alpha
    cleaned[~visible, :3] = 0
    return cleaned


def main() -> None:
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    specs = (
        HELPER.ActionSpec(
            "idle", uniform_indices(0, 120, 5), 4.8, -1,
            "center-body", "body-feet",
        ),
        HELPER.ActionSpec(
            "running", uniform_indices(0, 120, 4), 6.0, -1,
            "center-body", "body-feet",
        ),
        HELPER.ActionSpec(
            "attacking", uniform_indices(0, 120, 4), 6.0, 0,
            "preserve-source", "body-feet",
        ),
        HELPER.ActionSpec(
            "dying", uniform_indices(0, 96, 4), 6.0, 0,
            "preserve-source", "content-ground",
        ),
    )

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in specs:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            cache[(spec.name, source_index)] = clean_white_matte_edges(
                BASE.cutout_rgba(source_frames[source_index], model)
            )
            print(f"[longbow-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    source_body_heights: dict[str, int] = {}
    scale_by_action: dict[str, float] = {}
    for spec in specs:
        reference = cache[(spec.name, spec.indices[0])]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        body_height = body_y1 - body_y0 + 1
        source_body_heights[spec.name] = body_height
        scale_by_action[spec.name] = HELPER.TARGET_BODY_HEIGHT / body_height

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "runtimeIntegration": False,
        "bodyScaleReference": "hamster militia effective standing body",
        "sourceFacing": "right",
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "sourceBodyHeightByAction": source_body_heights,
        "cameraNormalizationScaleByAction": scale_by_action,
        "unifiedFinalEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "longbowExcludedFromBodyScale": True,
        "matteCleanup": {
            "alphaCutoff": MATTE_ALPHA_CUTOFF,
            "nearestReliableAlpha": MATTE_RELIABLE_ALPHA,
            "edgeRgb": "nearest reliable subject pixel",
        },
        "actions": {},
    }

    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        action_scale = scale_by_action[spec.name]
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, action_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cells = [
            clean_white_matte_edges(
                HELPER.place_cell(
                    rgba, action_scale, frame_width, spec.horizontal_mode,
                    spec.vertical_mode, reference_anchor,
                )
            )
            for rgba in rgba_frames
        ]
        Image.fromarray(HELPER.compose(cells), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0]))
            for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.name]}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": HELPER.FRAME_HEIGHT,
            "cols": HELPER.COLS,
            "rows": math.ceil(len(cells) / HELPER.COLS),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
