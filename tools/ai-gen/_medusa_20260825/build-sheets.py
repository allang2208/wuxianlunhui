#!/usr/bin/env python3
"""Build Medusa's accepted videos into scale-locked transparent sprite sheets.

Medusa is normalized from the effective upright body height in each source
video's first neutral frame.  Each action receives one fixed scale; individual
frames are never stretched to their pose-dependent alpha bounds.  This keeps
the human torso, snake-body thickness and foot line consistent while preserving
the natural collapse and attack trajectories.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
COMMON_PATH = ROOT.parent / "_brown_snake_20260825" / "build-sheets.py"

spec = importlib.util.spec_from_file_location("medusa_sheet_common", COMMON_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load sprite-sheet builder: {COMMON_PATH}")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

common.ROOT = ROOT
common.VIDEO_DIR = ROOT / "video"
common.OUT_DIR = ROOT / "generated" / "final"
common.PREVIEW_DIR = ROOT / "previews" / "final"
common.FOOT_Y = 470
common.CELL_HEIGHT = 512
common.EDGE_PAD = 20

TARGET_NEUTRAL_HEIGHT = 420.0


def effective_height(alpha: np.ndarray) -> float:
    """Measure head-to-ground height; never use horizontal tail extent."""
    _x0, y0, _x1, y1 = common.bbox_from_alpha(alpha)
    return float(y1 - y0)


def torso_center_x(alpha: np.ndarray) -> float:
    """Anchor on the upper body so tail motion cannot drag the root sideways."""
    x0, y0, x1, y1 = common.bbox_from_alpha(alpha)
    upper_end = min(y1, y0 + max(1, round((y1 - y0) * 0.58)))
    ys, xs = np.where(alpha[y0:upper_end, x0:x1] > common.ALPHA_THRESHOLD)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    return float(x0 + np.median(xs))


# The shared builder calls these metrics both for scale and for audit output.
common.body_thickness = effective_height
common.center_x = torso_center_x


TAIL_SOURCE_FRAMES = [
    0, 8, 16, 24, 32,                 # anticipation
    36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80,  # accelerated sweep
    87, 94, 101, 108, 114, 120,       # recovery
]
TAIL_FRAME_DURATIONS = [
    *([100] * 5),
    *([45] * 12),
    *([85] * 6),
]

ACTIONS = {
    "idle": {
        "video": common.VIDEO_DIR / "medusa-idle-doubao.mp4",
        "frames": list(range(0, 120, 10)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 4,
        "repeat": -1,
        "expectedFrames": 121,
    },
    "walking": {
        "video": common.VIDEO_DIR / "medusa-walking-doubao-v03.mp4",
        "frames": list(range(0, 120, 6)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 10,
        "repeat": -1,
        "expectedFrames": 121,
    },
    "petrifying_gaze": {
        "video": common.VIDEO_DIR / "medusa-petrifying-gaze-doubao.mp4",
        "frames": list(range(0, 121, 6)),
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1500,
        "repeat": 0,
        "expectedFrames": 121,
        "releaseSourceFrame": 66,
    },
    "tail_sweep": {
        "video": common.VIDEO_DIR / "medusa-tail-sweep-doubao.mp4",
        "frames": TAIL_SOURCE_FRAMES,
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": sum(TAIL_FRAME_DURATIONS),
        "frameDurations": TAIL_FRAME_DURATIONS,
        "repeat": 0,
        "expectedFrames": 121,
        "contactSourceFrame": 64,
        "phases": {
            "anticipation": {"frames": [0, 4], "frameMs": 100},
            "sweep": {"frames": [5, 16], "frameMs": 45},
            "recovery": {"frames": [17, 22], "frameMs": 85},
        },
    },
    "dying": {
        "video": common.VIDEO_DIR / "medusa-dying-h3.mp4",
        "frames": [0, 6, 12, 18, 24, 30, 34, 38, 42, 46, 50, 56, 67, 78, 89, 101, 123],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
        "expectedFrames": 124,
    },
}


def build_cells(action: dict, processed: dict, scale: float) -> list[Image.Image]:
    first_alpha = processed[action["frames"][0]][1]
    first_bbox = common.bbox_from_alpha(first_alpha)
    ref_x = common.center_x(first_alpha)
    ref_foot_y = first_bbox[3] - 1
    spans = [
        common.frame_extents(processed[index][1], scale, action["mode"], ref_x)
        for index in action["frames"]
    ]
    required_half = max(max(abs(left), abs(right)) for left, right in spans)
    cell_width = common.choose_cell_width(required_half)
    return [
        common.make_cell(
            *processed[index], scale, cell_width, action["mode"], ref_x, ref_foot_y
        )
        for index in action["frames"]
    ]


def write_variable_preview(action: dict, processed: dict, scale: float) -> None:
    cells = build_cells(action, processed, scale)
    preview_frames = []
    for cell in cells:
        background = Image.new("RGB", cell.size, (30, 30, 34))
        background.paste(cell.convert("RGB"), (0, 0), cell.getchannel("A"))
        preview_frames.append(
            background.resize((round(cell.width * 0.5), 256), Image.Resampling.LANCZOS)
        )
    preview = common.PREVIEW_DIR / "tail_sweep.gif"
    preview_frames[0].save(
        preview,
        save_all=True,
        append_images=preview_frames[1:],
        duration=action["frameDurations"],
        loop=0,
        disposal=2,
    )


def main() -> None:
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    common.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: common.decode(action["video"]) for name, action in ACTIONS.items()}
    for name, frames in decoded.items():
        expected = ACTIONS[name]["expectedFrames"]
        if len(frames) != expected:
            raise ValueError(f"{name}: expected {expected} frames, got {len(frames)}")

    model = common.get_model()
    processed = {
        name: common.process_frames(model, decoded[name], action["frames"], name)
        for name, action in ACTIONS.items()
    }
    source_heights = {
        name: effective_height(processed[name][action["frames"][0]][1])
        for name, action in ACTIONS.items()
    }
    action_scales = {
        name: TARGET_NEUTRAL_HEIGHT / height
        for name, height in source_heights.items()
    }

    manifest = {
        "normalization": "one fixed per-action scale from first neutral frame effective height",
        "targetNeutralHeight": TARGET_NEUTRAL_HEIGHT,
        "sourceNeutralHeights": source_heights,
        "actionScales": action_scales,
        "rootAnchor": "upper-body alpha median x; horizontal tail extent excluded",
        "footY": common.FOOT_Y,
        "stateScaleContract": "no per-frame scaling; pose height changes remain natural",
        "actions": {},
    }
    for name, action in ACTIONS.items():
        built = common.build_sheet(name, action, processed[name], action_scales[name])
        built["effectiveHeightRange"] = built.pop("bodyThicknessRange")
        if "frameDurations" in action:
            built["frameDurations"] = action["frameDurations"]
            built["phases"] = action["phases"]
            write_variable_preview(action, processed[name], action_scales[name])
        if "releaseSourceFrame" in action:
            built["releaseSourceFrame"] = action["releaseSourceFrame"]
            built["releaseFrame"] = action["frames"].index(action["releaseSourceFrame"])
        if "contactSourceFrame" in action:
            built["contactSourceFrame"] = action["contactSourceFrame"]
            built["contactFrame"] = action["frames"].index(action["contactSourceFrame"])
        manifest["actions"][name] = built
        print(f"[medusa] built {name}: {built}", flush=True)

    path = ROOT / "sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[medusa] manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
