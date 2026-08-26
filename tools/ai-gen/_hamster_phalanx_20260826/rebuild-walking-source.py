#!/usr/bin/env python3
"""Rebuild only the hamster-phalanx walk from a dense, duration-preserving loop."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
BUILD_SCRIPT = ROOT / "build-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("hamster_phalanx_source_builder", BUILD_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import source-sheet builder: {BUILD_SCRIPT}")
BUILD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILD
SPEC.loader.exec_module(BUILD)

VIDEO_NAME = "hamster_phalanx_walking_h3_v02.mp4"
SOURCE_INDICES = tuple(range(0, 121, 4))
SOURCE_RATE = 6.0


def main() -> None:
    frames, video_rate = BUILD.HELPER.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    if len(frames) != 124 or round(video_rate) != 24:
        raise RuntimeError(f"Unexpected walking source: frames={len(frames)} fps={video_rate}")

    report_path = ROOT / "source-sheet-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    fixed_scale = float(report["fixedScaleAcrossAllActions"])
    spec = BUILD.ActionSpec(
        "walking",
        VIDEO_NAME,
        SOURCE_INDICES,
        SOURCE_RATE,
        -1,
        "center-body",
        "body-feet",
    )

    cutout_dir = ROOT / "frames" / "birefnet-source" / "walking"
    cutout_dir.mkdir(parents=True, exist_ok=True)
    model = None
    rgba_frames: list[np.ndarray] = []
    cleanup_removed: dict[int, int] = {}
    for source_index in SOURCE_INDICES:
        cutout_path = cutout_dir / f"source-{source_index:03d}.png"
        if cutout_path.exists():
            rgba = np.asarray(Image.open(cutout_path).convert("RGBA")).copy()
            removed = 0
            print(f"[phalanx-walk] reuse BiRefNet f{source_index}", flush=True)
        else:
            if model is None:
                model = BUILD.HELPER.BASE.get_model()
            rgba = BUILD.HELPER.BASE.cutout_rgba(frames[source_index], model)
            rgba, removed = BUILD.HELPER.strip_small_cutout_components(
                rgba, min_source_area=600
            )
            Image.fromarray(rgba, "RGBA").save(
                cutout_path, optimize=True, compress_level=9
            )
            print(f"[phalanx-walk] BiRefNet f{source_index}", flush=True)
        rgba_frames.append(rgba)
        cleanup_removed[source_index] = removed

    frame_width, reference_anchor = BUILD.HELPER.choose_width(
        rgba_frames, fixed_scale, spec.horizontal_mode
    )
    cells = [
        BUILD.HELPER.place_cell(
            rgba,
            fixed_scale,
            frame_width,
            spec.horizontal_mode,
            spec.vertical_mode,
            reference_anchor,
        )
        for rgba in rgba_frames
    ]

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    sheet_path = source_dir / "walking.png"
    Image.fromarray(BUILD.HELPER.compose(cells), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    BUILD.HELPER.save_previews(spec, cells, preview_dir)

    validation = BUILD.HELPER.BASE.validate_cells(cells, spec.repeat)
    validation.update(BUILD.HELPER.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    report["smallComponentCleanup"]["removedAlphaPixelsBySourceFrame"]["walking"] = {
        str(index): removed for index, removed in cleanup_removed.items()
    }
    report["actions"]["walking"] = {
        "source": f"videos/{VIDEO_NAME}",
        "sourceFrameRate": video_rate,
        "sourceIndices": list(SOURCE_INDICES),
        "samplingPolicy": "every fourth native frame across the accepted loop; preserves the complete native gait and clip duration",
        "nativeLoopFrameCount": len(frames),
        "nativeDurationSeconds": len(frames) / video_rate,
        "frameCount": len(cells),
        "endFrame": len(cells) - 1,
        "frameWidth": frame_width,
        "frameHeight": BUILD.FRAME_HEIGHT,
        "cols": BUILD.COLS,
        "rows": math.ceil(len(cells) / BUILD.COLS),
        "previewFrameRate": spec.frame_rate,
        "repeat": spec.repeat,
        "horizontalMode": spec.horizontal_mode,
        "verticalMode": spec.vertical_mode,
        "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "validation": validation,
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["actions"]["walking"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
