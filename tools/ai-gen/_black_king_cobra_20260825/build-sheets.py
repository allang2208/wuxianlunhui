#!/usr/bin/env python3
"""Build the accepted black-king-cobra videos into grounded runtime sheets.

The common snake cutout/normalization implementation lives beside the brown-snake
source package. This wrapper keeps the accepted source-frame selection and the
measured maximum head-extension frame as cobra-specific provenance.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
COMMON_PATH = ROOT.parent / "_brown_snake_20260825" / "build-sheets.py"

spec = importlib.util.spec_from_file_location("snake_sheet_common", COMMON_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load snake sheet builder: {COMMON_PATH}")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

common.ROOT = ROOT
common.VIDEO_DIR = ROOT / "video"
common.OUT_DIR = ROOT / "generated" / "final"
common.PREVIEW_DIR = ROOT / "previews" / "final"
common.TARGET_BODY_THICKNESS = 48.0
common.FOOT_Y = 420

# The horizontal walking reference came from a separately prepared source and is
# ~2.2x larger than the three coiled-state videos. Measure scale on the skeleton
# centerline, then apply one shared correction to the entire state; never resize
# individual frames or use the pose-dependent alpha bbox.
STATE_SCALE_CORRECTIONS = {
    "idle": 1.0,
    "walking": 0.448,
    "attacking": 1.0,
    "dying": 1.0,
}

ATTACK_SOURCE_FRAMES = list(range(0, 73, 6)) + [77] + list(range(84, 121, 6))
ACTIONS = {
    "idle": {
        "video": common.VIDEO_DIR / "black-king-cobra-idle-h3.mp4",
        "frames": list(range(0, 120, 10)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 4,
        "repeat": -1,
        "expectedFrames": 124,
    },
    "walking": {
        "video": common.VIDEO_DIR / "black-king-cobra-walking-doubao.mp4",
        "frames": list(range(0, 120, 6)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
        "expectedFrames": 121,
    },
    "attacking": {
        # Source frame 77 is the measured farthest-forward head pose.
        "video": common.VIDEO_DIR / "black-king-cobra-attacking-doubao.mp4",
        "frames": ATTACK_SOURCE_FRAMES,
        "cols": 6,
        "mode": "source_motion",
        "duration": 1200,
        "repeat": 0,
        "expectedFrames": 121,
        "releaseSourceFrame": 77,
    },
    "dying": {
        "video": common.VIDEO_DIR / "black-king-cobra-dying-doubao.mp4",
        "frames": list(range(0, 73, 6)) + [84, 96, 108, 120],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
        "expectedFrames": 121,
    },
}


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
    source_thicknesses = {
        name: common.body_thickness(processed[name][action["frames"][0]][1])
        for name, action in ACTIONS.items()
    }
    action_scales = {
        name: common.TARGET_BODY_THICKNESS / thickness * STATE_SCALE_CORRECTIONS[name]
        for name, thickness in source_thicknesses.items()
    }

    manifest = {
        "normalization": "fixed per-action scale from neutral-frame body thickness",
        "targetBodyThickness": common.TARGET_BODY_THICKNESS,
        "sourceBodyThicknesses": source_thicknesses,
        "stateScaleCorrections": STATE_SCALE_CORRECTIONS,
        "stateScaleContract": "one shared correction per source video; no per-frame scaling",
        "scaleEvidence": {
            "metric": "morphological-skeleton median local diameter on formal sheets",
            "idleMedianPxBefore": 21.97,
            "walkingMedianPxBefore": 49.37,
            "walkingCorrection": 0.448,
            "walkingExpectedMedianPxAfter": 22.12
        },
        "actionScales": action_scales,
        "actions": {},
    }
    for name, action in ACTIONS.items():
        built = common.build_sheet(name, action, processed[name], action_scales[name])
        if "releaseSourceFrame" in action:
            built["releaseSourceFrame"] = action["releaseSourceFrame"]
            built["releaseFrame"] = action["frames"].index(action["releaseSourceFrame"])
            built["releaseContract"] = "measured farthest-forward snake-head frame"
        manifest["actions"][name] = built
        print(f"[black-king-cobra] built {name}: {built}", flush=True)

    path = ROOT / "sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[black-king-cobra] manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
