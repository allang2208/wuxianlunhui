#!/usr/bin/env python3
"""Build the accepted MiniMax H3 hamster-sniper running source sheet."""

from __future__ import annotations

import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
BUILDER_PATH = ROOT / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("sniper_sheet_builder_h3", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BUILDER_PATH}")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)

VIDEO_NAME = "running-h3-v02.mp4"
SOURCE_INDICES = tuple(range(66, 88))
SAME_PHASE_END = 88
SOURCE_RATE = 24.0


def main() -> None:
    frames, video_rate = BUILDER.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    model = BUILDER.BASE.get_model()
    rgba_frames = []
    for source_index in SOURCE_INDICES:
        rgba_frames.append(BUILDER.BASE.cutout_rgba(frames[source_index], model))
        print(f"[sniper-running-h3-v02] BiRefNet f{source_index}", flush=True)

    source_body_heights = []
    for rgba in rgba_frames:
        _, body_y0, _, body_y1 = BUILDER.opened_body_bbox(rgba)
        source_body_heights.append(body_y1 - body_y0 + 1)
    reference_source_body_height = float(statistics.median(source_body_heights))
    fixed_scale = BUILDER.TARGET_BODY_HEIGHT / reference_source_body_height
    frame_width, reference_anchor = BUILDER.choose_width(
        rgba_frames, fixed_scale, "center-body"
    )
    cells = [
        BUILDER.place_cell(
            rgba,
            fixed_scale,
            frame_width,
            "center-body",
            "body-feet",
            reference_anchor,
        )
        for rgba in rgba_frames
    ]

    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(BUILDER.compose(cells), "RGBA").save(
        output_dir / "running-h3-v02.png", optimize=True, compress_level=9
    )
    action_spec = BUILDER.ActionSpec(
        "running-h3-v02",
        VIDEO_NAME,
        SOURCE_INDICES,
        SOURCE_RATE,
        -1,
        "center-body",
        "body-feet",
    )
    BUILDER.save_previews(action_spec, cells, preview_dir)
    validation = BUILDER.BASE.validate_cells(cells, action_spec.repeat)
    validation.update(BUILDER.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int((cell[..., :3][cell[..., 3] == 0] != 0).sum()) for cell in cells
    )
    report = {
        "source": f"videos/{VIDEO_NAME}",
        "videoFrameRate": video_rate,
        "sourceIndices": list(SOURCE_INDICES),
        "samePhaseValidationFrame": SAME_PHASE_END,
        "sourceFrameRate": SOURCE_RATE,
        "frameCount": len(cells),
        "frameWidth": frame_width,
        "frameHeight": BUILDER.FRAME_HEIGHT,
        "cols": BUILDER.COLS,
        "rows": math.ceil(len(cells) / BUILDER.COLS),
        "fixedScale": fixed_scale,
        "fixedScaleReference": "median opened-body height across accepted H3 loop window",
        "sourceBodyHeightMin": min(source_body_heights),
        "sourceBodyHeightMedian": reference_source_body_height,
        "sourceBodyHeightMax": max(source_body_heights),
        "feetY": BUILDER.FEET_Y,
        "validation": validation,
        "loopSelectionEvidence": {
            "start": 66,
            "samePhaseEnd": SAME_PHASE_END,
            "period": 22,
            "overallIou": 0.9732267590938832,
            "legIou": 0.9452012574739568,
            "visibleDelta": 12.425518989562988,
        },
    }
    (ROOT / "running-h3-v02-source-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
