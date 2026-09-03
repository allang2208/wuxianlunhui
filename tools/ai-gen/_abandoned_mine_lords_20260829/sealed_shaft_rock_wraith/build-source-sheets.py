#!/usr/bin/env python3
"""Build normalized transparent source sheets for the Sealed-Shaft Rock Wraith.

The narrow upward drill is excluded from effective-body scale measurement.
Idle and walking skip the H3 opening zoom before choosing their stable loop
window. Recover actions retain the complete authored path. Every action is
placed at the same 460px upright body target and y=650 foot line in 672px-high cells.
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
HELPER_PATH = (
    REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825"
    / "build-halberdier-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("sealed_wraith_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


HELPER.FRAME_HEIGHT = 672
HELPER.FEET_Y = 650
HELPER.TARGET_BODY_HEIGHT = 460
HELPER.BODY_OPEN_KERNEL_SOURCE = 31
HELPER.BODY_OPEN_KERNEL_OUTPUT = 21
HELPER.COLS = 8
HELPER.MARGIN = 16
_helper_round_width = HELPER.round_width
HELPER.round_width = lambda width: max(640, _helper_round_width(width))

SOURCES = {
    "idle": "idle-minimax-h3-v01.mp4",
    "walking": "walking-minimax-h3-v01.mp4",
    "crystalArmSmash": "crystal-arm-smash-minimax-h3-v02.mp4",
    "borequake": "borequake-minimax-h3-v02.mp4",
    "drillRush": "drill-rush-minimax-h3-v03.mp4",
    "dying": "dying-minimax-h3-v01.mp4",
}

# H3 sources are 124 frames at 24fps. Every fourth authored frame gives a
# compact 6fps source sheet; mandatory 2x RIFE restores 12fps. The loop sources
# skip f0..f20 because those frames contain H3's visible automatic camera zoom.
SPECS = (
    HELPER.ActionSpec("idle", tuple(range(24, 121, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("walking", tuple(range(24, 121, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("crystalArmSmash", tuple(range(0, 121, 4)), 6.0, 0, "preserve-source", "body-feet"),
    HELPER.ActionSpec("borequake", tuple(range(0, 121, 4)), 6.0, 0, "center-body", "body-feet"),
    # World translation is supplied by the combat state machine. Recenter the
    # authored pose so source-video root drift cannot double the charge motion.
    HELPER.ActionSpec("drillRush", tuple(range(0, 121, 4)), 6.0, 0, "center-body", "body-feet"),
    # The corpse is fully settled by f72; f80 retains a short readable hold.
    HELPER.ActionSpec("dying", tuple(range(0, 81, 4)), 6.0, 0, "preserve-source", "content-ground"),
)


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


def choose_center_width_variable(
    rgba_frames: list[np.ndarray], scales: list[float]
) -> int:
    half_span = 0.0
    for rgba, scale in zip(rgba_frames, scales):
        x0, _, x1, _ = BASE.alpha_bbox(rgba)
        anchor = HELPER.body_anchor_x(rgba)
        half_span = max(
            half_span,
            (anchor - x0) * scale,
            (x1 - anchor + 1) * scale,
        )
    return HELPER.round_width(half_span * 2 + HELPER.MARGIN * 2)


def main() -> None:
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    for action, (frames, fps) in videos.items():
        if len(frames) != 124 or abs(fps - 24.0) > 0.01:
            raise RuntimeError(f"Unexpected {action} source: {len(frames)} frames at {fps}")

    legacy_frame_dir = ROOT / "frames" / "birefnet-source"
    corrected_frame_dir = ROOT / "frames" / "birefnet-source-v02"
    corrected_actions = {"crystalArmSmash", "borequake", "drillRush"}
    legacy_frame_dir.mkdir(parents=True, exist_ok=True)
    corrected_frame_dir.mkdir(parents=True, exist_ok=True)
    model = None
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in SPECS:
        source_frames = videos[spec.name][0]
        frame_dir = corrected_frame_dir if spec.name in corrected_actions else legacy_frame_dir
        for source_index in spec.indices:
            key = (spec.name, source_index)
            cached_path = frame_dir / f"{spec.name}-f{source_index:03d}.png"
            if cached_path.exists():
                cache[key] = np.asarray(Image.open(cached_path).convert("RGBA")).copy()
                print(f"[sealed-wraith] {spec.name} cache f{source_index}", flush=True)
            else:
                if model is None:
                    model = BASE.get_model()
                cache[key] = BASE.cutout_rgba(source_frames[source_index], model)
                Image.fromarray(cache[key], "RGBA").save(
                    cached_path, optimize=True, compress_level=9
                )
                print(f"[sealed-wraith] {spec.name} BiRefNet f{source_index}", flush=True)

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "pipeline": "MiniMax H3 -> BiRefNet-general -> fixed per-action camera scale -> RIFE-ready source sheets",
        "scaleContract": "460px effective ore body and y=650 foot line; narrow drill excluded; fixed per-action scale; drillRush body-centered because game code supplies world translation",
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "loopOpeningZoomRemovedThroughFrame": 20,
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        reference = rgba_frames[0]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        source_body_height = body_y1 - body_y0 + 1
        action_scale = HELPER.TARGET_BODY_HEIGHT / source_body_height
        if spec.name == "walking":
            placement_scales = []
            for rgba in rgba_frames:
                _, y0, _, y1 = HELPER.opened_body_bbox(rgba)
                placement_scales.append(HELPER.TARGET_BODY_HEIGHT / (y1 - y0 + 1))
            frame_width = choose_center_width_variable(rgba_frames, placement_scales)
            reference_anchor = None
            scale_mode = "per-frame-camera-zoom-correction"
        else:
            placement_scales = [action_scale] * len(rgba_frames)
            frame_width, reference_anchor = HELPER.choose_width(
                rgba_frames, action_scale, spec.horizontal_mode
            )
            scale_mode = "fixed-action-scale"
        if frame_width > 1536:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cols = min(HELPER.COLS, max(1, 8192 // frame_width))
        cells = [
            HELPER.place_cell(
                rgba, scale, frame_width, spec.horizontal_mode,
                spec.vertical_mode, reference_anchor,
            )
            for rgba, scale in zip(rgba_frames, placement_scales)
        ]
        Image.fromarray(compose(cells, cols), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.name]}",
            "sourceIndices": list(spec.indices),
            "sourceBodyHeight": source_body_height,
            "fixedScale": action_scale,
            "scaleMode": scale_mode,
            "placementScaleMin": min(placement_scales),
            "placementScaleMax": max(placement_scales),
            "frameCount": len(cells),
            "frameWidth": frame_width,
            "frameHeight": HELPER.FRAME_HEIGHT,
            "cols": cols,
            "rows": math.ceil(len(cells) / cols),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    report["actions"]["idle"]["discardedOpeningZoomFrames"] = list(range(0, 24))
    report["actions"]["walking"]["discardedOpeningZoomFrames"] = list(range(0, 24))
    report["actions"]["dying"]["stableCorpseSourceFrame"] = 72
    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
