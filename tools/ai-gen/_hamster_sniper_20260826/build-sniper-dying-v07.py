#!/usr/bin/env python3
"""Build the accepted v07 hamster-sniper death source sheet only."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
BUILDER_PATH = ROOT / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("sniper_sheet_builder", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import source-sheet builder: {BUILDER_PATH}")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)

VIDEO_NAME = "dying-doubao-v07.mp4"
SOURCE_INDICES = tuple(range(0, 17, 2))
SOURCE_FRAME_RATE = 12.0


def main() -> None:
    report_path = ROOT / "source-sheet-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    fixed_scale = float(report["fixedScaleAcrossAllActions"])

    frames, video_fps = BUILDER.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    if max(SOURCE_INDICES) >= len(frames):
        raise RuntimeError(f"v07 has only {len(frames)} frames")

    model = BUILDER.BASE.get_model()
    rgba_frames = []
    removed_by_frame: dict[str, int] = {}
    for source_index in SOURCE_INDICES:
        rgba = BUILDER.BASE.cutout_rgba(frames[source_index], model)
        rgba, removed = BUILDER.strip_small_cutout_components(rgba)
        rgba_frames.append(rgba)
        removed_by_frame[str(source_index)] = removed
        print(f"[sniper-dying-v07] BiRefNet f{source_index}", flush=True)

    frame_width, reference_anchor = BUILDER.choose_width(
        rgba_frames, fixed_scale, "preserve-source"
    )
    if frame_width > 1024:
        raise RuntimeError(f"dying-v07 needs unsupported frame width {frame_width}")

    cells = [
        BUILDER.place_cell(
            rgba,
            fixed_scale,
            frame_width,
            "preserve-source",
            "content-ground",
            reference_anchor,
        )
        for rgba in rgba_frames
    ]
    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(BUILDER.compose(cells), "RGBA").save(
        output_dir / "dying.png", optimize=True, compress_level=9
    )

    action_spec = BUILDER.ActionSpec(
        "dying",
        VIDEO_NAME,
        SOURCE_INDICES,
        SOURCE_FRAME_RATE,
        0,
        "preserve-source",
        "content-ground",
    )
    BUILDER.save_previews(action_spec, cells, preview_dir)
    validation = BUILDER.BASE.validate_cells(cells, 0)
    validation.update(BUILDER.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    report["actions"]["dying"] = {
        "source": f"videos/{VIDEO_NAME}",
        "sourceFrameRate": video_fps,
        "sourceIndices": list(SOURCE_INDICES),
        "frameCount": len(cells),
        "endFrame": len(cells) - 1,
        "frameWidth": frame_width,
        "frameHeight": BUILDER.FRAME_HEIGHT,
        "cols": BUILDER.COLS,
        "rows": math.ceil(len(cells) / BUILDER.COLS),
        "previewFrameRate": SOURCE_FRAME_RATE,
        "repeat": 0,
        "horizontalMode": "preserve-source",
        "verticalMode": "content-ground",
        "smallComponentCleanupRemovedAlphaPixels": removed_by_frame,
        "validation": validation,
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["actions"]["dying"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
