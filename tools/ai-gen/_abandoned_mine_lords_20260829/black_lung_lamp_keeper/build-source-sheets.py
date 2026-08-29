#!/usr/bin/env python3
"""Build normalized transparent source sheets for the Black-Lung Lamp Keeper.

The pickaxe is deliberately excluded from scale measurement.  Every upright
action is normalized to the accepted idle sheet's 460px effective body height
inside a 640px-high cell with the same y=599 foot line.  Recover actions keep
the body planted; death preserves the authored source-space horizontal fall and
uses the settled silhouette as its ground contact.
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
SPEC = importlib.util.spec_from_file_location("black_lung_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


HELPER.FRAME_HEIGHT = 640
HELPER.FEET_Y = 599
HELPER.TARGET_BODY_HEIGHT = 460
HELPER.BODY_OPEN_KERNEL_SOURCE = 31
HELPER.BODY_OPEN_KERNEL_OUTPUT = 21
HELPER.COLS = 8
HELPER.MARGIN = 16
_helper_round_width = HELPER.round_width
HELPER.round_width = lambda width: max(640, _helper_round_width(width))

SOURCES = {
    "walking": "walking-minimax-h3-v01.mp4",
    "pickaxeSlam": "pickaxe-slam-minimax-h3-v01.mp4",
    "blackLungCough": "black-lung-cough-minimax-h3-v01.mp4",
    "lanternOverload": "lantern-overload-minimax-h3-v01.mp4",
    "dying": "dying-minimax-h3-v01.mp4",
}

# H3 sources are 124 frames at 24fps.  Source sheets intentionally retain
# every fourth frame (6fps) so mandatory 2x RIFE restores a compact 12fps
# runtime animation without inventing a new motion path.
SPECS = (
    HELPER.ActionSpec("walking", tuple(range(0, 123, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("pickaxeSlam", tuple(range(0, 121, 4)), 6.0, 0, "center-body", "body-feet"),
    HELPER.ActionSpec("blackLungCough", tuple(range(0, 121, 4)), 6.0, 0, "center-body", "body-feet"),
    HELPER.ActionSpec("lanternOverload", tuple(range(0, 121, 4)), 6.0, 0, "center-body", "body-feet"),
    # The corpse is already settled by about source f48; f80 retains a useful
    # hold while avoiding three extra seconds of redundant still frames.
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


def main() -> None:
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    for action, (frames, fps) in videos.items():
        if len(frames) != 124 or abs(fps - 24.0) > 0.01:
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
                print(f"[black-lung] {spec.name} cache f{source_index}", flush=True)
            else:
                if model is None:
                    model = BASE.get_model()
                cache[key] = BASE.cutout_rgba(source_frames[source_index], model)
                Image.fromarray(cache[key], "RGBA").save(
                    cached_path, optimize=True, compress_level=9
                )
                print(f"[black-lung] {spec.name} BiRefNet f{source_index}", flush=True)

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "pipeline": "MiniMax H3 -> BiRefNet-general -> fixed effective-body scale -> RIFE-ready source sheets",
        "scaleContract": "accepted idle effective body height and foot line; thin pickaxe excluded",
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        reference = rgba_frames[0]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        source_body_height = body_y1 - body_y0 + 1
        action_scale = HELPER.TARGET_BODY_HEIGHT / source_body_height
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, action_scale, spec.horizontal_mode
        )
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

    report["actions"]["walking"]["duplicateEndpointSourceFrame"] = 123
    report["actions"]["dying"]["stableCorpseSourceFrame"] = 48
    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
