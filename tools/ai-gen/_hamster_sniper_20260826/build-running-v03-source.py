#!/usr/bin/env python3
"""Build the native-consecutive hamster-sniper running v03 source sheet."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
BUILDER_PATH = ROOT / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("sniper_sheet_builder", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BUILDER_PATH}")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)

VIDEO_NAME = "running-doubao-v02.mp4"
SOURCE_INDICES = tuple(range(78, 94))
SOURCE_RATE = 24.0


def main() -> None:
    frames, video_rate = BUILDER.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    model = BUILDER.BASE.get_model()
    rgba_frames = []
    for source_index in SOURCE_INDICES:
        rgba_frames.append(BUILDER.BASE.cutout_rgba(frames[source_index], model))
        print(f"[sniper-running-v03] BiRefNet f{source_index}", flush=True)

    common_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    fixed_scale = float(common_report["fixedScaleAcrossAllActions"])
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
        output_dir / "running-v03.png", optimize=True, compress_level=9
    )
    action_spec = BUILDER.ActionSpec(
        "running-v03",
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
        "samePhaseValidationFrame": 94,
        "sourceFrameRate": SOURCE_RATE,
        "frameCount": len(cells),
        "frameWidth": frame_width,
        "frameHeight": BUILDER.FRAME_HEIGHT,
        "cols": BUILDER.COLS,
        "rows": math.ceil(len(cells) / BUILDER.COLS),
        "fixedScale": fixed_scale,
        "feetY": BUILDER.FEET_Y,
        "validation": validation,
        "loopSelectionEvidence": {
            "start": 78,
            "samePhaseEnd": 94,
            "period": 16,
            "overallIou": 0.9886950245555678,
            "legIou": 0.9725509649682281,
            "visibleDelta": 4.317906856536865,
        },
    }
    (ROOT / "running-v03-source-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
