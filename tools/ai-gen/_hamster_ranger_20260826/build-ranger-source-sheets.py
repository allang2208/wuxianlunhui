#!/usr/bin/env python3
"""Build transparent idle, running and dying ranger source sheets."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825" / "build-halberdier-sheets.py"
SPEC = importlib.util.spec_from_file_location("ranger_halberd_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE

SOURCES = {
    "idle": "idle-h3.mp4",
    "running": "running-h3-v02.mp4",
    "dying": "dying-h3.mp4",
}


def main() -> None:
    videos: dict[str, tuple[list[np.ndarray], float]] = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    specs = (
        HELPER.ActionSpec(
            "idle",
            BASE.visual_resample_indices(videos["idle"][0], 0, 119, 12),
            4.0,
            -1,
            "center-body",
            "body-feet",
        ),
        HELPER.ActionSpec(
            "running",
            tuple(range(0, 16, 2)),
            12.0,
            -1,
            "center-body",
            "body-feet",
        ),
        HELPER.ActionSpec(
            "dying",
            tuple(range(8, 34, 2)),
            12.0,
            0,
            "preserve-source",
            "content-ground",
        ),
    )

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in specs:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            key = (spec.name, source_index)
            cache[key] = BASE.cutout_rgba(source_frames[source_index], model)
            print(f"[ranger-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_reference = cache[("idle", specs[0].indices[0])]
    _, body_y0, _, body_y1 = HELPER.opened_body_bbox(idle_reference)
    reference_body_height = body_y1 - body_y0 + 1
    fixed_scale = HELPER.TARGET_BODY_HEIGHT / reference_body_height

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleAcrossActions": fixed_scale,
        "actions": {},
    }

    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, fixed_scale, spec.horizontal_mode
        )
        cells = [
            HELPER.place_cell(
                rgba,
                fixed_scale,
                frame_width,
                spec.horizontal_mode,
                spec.vertical_mode,
                reference_anchor,
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
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
