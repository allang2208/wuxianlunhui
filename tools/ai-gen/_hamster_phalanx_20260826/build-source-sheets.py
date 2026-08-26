#!/usr/bin/env python3
"""Build transparent hamster-phalanx source sheets from the accepted H3 videos."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_SCRIPT = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("hamster_phalanx_sheet_helper", HELPER_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {HELPER_SCRIPT}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)

FRAME_HEIGHT = 512
FEET_Y = 351
TARGET_BODY_HEIGHT = 129
COLS = 8


@dataclass(frozen=True)
class ActionSpec:
    name: str
    video_name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def main() -> None:
    video_names = {
        "idle": "hamster_phalanx_idle_h3.mp4",
        "walking": "hamster_phalanx_walking_h3_v02.mp4",
        "attacking": "hamster_phalanx_attacking_h3.mp4",
        "dying": "hamster_phalanx_dying_h3.mp4",
    }
    videos = {
        name: HELPER.BASE.decode_video(ROOT / "videos" / video_name)
        for name, video_name in video_names.items()
    }
    specs = (
        ActionSpec(
            "idle",
            video_names["idle"],
            (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110),
            8.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "walking",
            video_names["walking"],
            tuple(range(0, 121, 4)),
            6.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "attacking",
            video_names["attacking"],
            (0, 6, 12, 18, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 79, 81, 83),
            12.0,
            0,
            "preserve-source",
            "body-feet",
        ),
        ActionSpec(
            "dying",
            video_names["dying"],
            (0, 8, 14, 18, 22, 26, 30, 34, 38, 42, 48, 56, 68, 84, 104, 123),
            10.0,
            0,
            "preserve-source",
            "content-ground",
        ),
    )

    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    cutout_dir = ROOT / "frames" / "birefnet-source"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    cutout_dir.mkdir(parents=True, exist_ok=True)

    model = HELPER.BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    cleanup_removed: dict[str, dict[int, int]] = {spec.name: {} for spec in specs}
    for spec in specs:
        action_cutout_dir = cutout_dir / spec.name
        action_cutout_dir.mkdir(parents=True, exist_ok=True)
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            rgba = HELPER.BASE.cutout_rgba(source_frames[source_index], model)
            rgba, removed = HELPER.strip_small_cutout_components(rgba, min_source_area=600)
            cache[(spec.name, source_index)] = rgba
            cleanup_removed[spec.name][source_index] = removed
            Image.fromarray(rgba, "RGBA").save(
                action_cutout_dir / f"source-{source_index:03d}.png",
                optimize=True,
                compress_level=9,
            )
            print(f"[phalanx-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_reference = cache[("idle", specs[0].indices[0])]
    _, body_y0, _, body_y1 = HELPER.opened_body_bbox(idle_reference)
    reference_body_height = body_y1 - body_y0 + 1
    fixed_scale = TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "acceptedMovementSource": "walking v02; all running candidates excluded",
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "smallComponentCleanup": {
            "purpose": "remove detached generation specks while retaining shield and double-bladed axe",
            "minimumSourceComponentArea": 600,
            "removedAlphaPixelsBySourceFrame": cleanup_removed,
        },
        "actions": {},
    }

    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, fixed_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
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
        sheet_path = output_dir / f"{spec.name}.png"
        Image.fromarray(HELPER.compose(cells), "RGBA").save(
            sheet_path, optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = HELPER.BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{spec.video_name}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "previewFrameRate": spec.frame_rate,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
            "validation": validation,
        }

    report_path = ROOT / "source-sheet-report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
