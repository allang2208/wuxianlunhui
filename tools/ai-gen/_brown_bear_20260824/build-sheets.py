#!/usr/bin/env python3
"""Build the currently accepted brown-bear sheets with the quadruped contract."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "_zombie_dog_upgrade_20260823" / "build-sheets.py"
SPEC = importlib.util.spec_from_file_location("zombie_dog_sheet_builder", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load shared quadruped builder: {SOURCE}")
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)

builder.ROOT = ROOT
builder.VIDEO_DIR = ROOT / "video"
builder.OUT_DIR = ROOT / "generated" / "final"
builder.PREVIEW_DIR = ROOT / "previews" / "final"
builder.ACTIONS = {
    "idle": {
        "video": builder.VIDEO_DIR / "brown-bear-idle-v2.mp4",
        "frames": [0, 11, 22, 33, 44, 55, 65, 76, 87, 98, 106, 120],
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 3,
        "repeat": -1,
    },
    "walking": {
        # Contact-sheet phase matches: 11~54 is one 44-frame gait period.
        "video": builder.VIDEO_DIR / "brown-bear-walking-v2.mp4",
        "frames": list(range(11, 55, 2)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
    },
    "attacking": {
        # Complete swipe/bite lunge from neutral through recovery. Preserve the
        # source-space displacement so the forward strike remains readable.
        "video": builder.VIDEO_DIR / "brown-bear-attacking-v3.mp4",
        # V3 keeps the whole muzzle/jaw inside a 10% source-video safety frame.
        # Frames 58~61 have a short red/green interpolation ghost; use clean
        # frame 62 without changing the overall attack window.
        "frames": [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48,
                   52, 56, 62, 64, 68, 72, 76, 80, 84, 88],
        "cols": 6,
        "mode": "source_motion",
        "duration": 950,
        "repeat": 0,
    },
    "dying": {
        # Dense collapse followed by two settled-corpse hold frames.
        "video": builder.VIDEO_DIR / "brown-bear-dying.mp4",
        "frames": list(range(8, 63, 3)) + [76, 104],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
    },
}


def main() -> None:
    builder.OUT_DIR.mkdir(parents=True, exist_ok=True)
    builder.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: builder.decode(spec["video"]) for name, spec in builder.ACTIONS.items()}
    for name, frames in decoded.items():
        last = max(builder.ACTIONS[name]["frames"])
        if last >= len(frames):
            raise ValueError(f"{name}: frame {last} outside decoded length {len(frames)}")

    model = builder.get_model()
    processed = {
        name: builder.process_frames(model, decoded[name], spec["frames"], name)
        for name, spec in builder.ACTIONS.items()
    }
    ref_alpha = processed["idle"][builder.ACTIONS["idle"]["frames"][0]][1]
    _x0, y0, _x1, y1 = builder.bbox_from_alpha(ref_alpha)
    action_scales = {}
    for name, action in builder.ACTIONS.items():
        first_alpha = processed[name][action["frames"][0]][1]
        _ax0, ay0, _ax1, ay1 = builder.bbox_from_alpha(first_alpha)
        # Attack uses a deliberately wider safety framing than idle/walking.
        # Normalize each action's neutral first frame to the same body height,
        # then keep that scale fixed for every frame inside the action.
        action_scales[name] = builder.TARGET_HEIGHT / (ay1 - ay0)
    manifest = {
        "referenceCell": builder.REFERENCE_CELL,
        "referenceHeight": y1 - y0,
        "targetHeight": builder.TARGET_HEIGHT,
        "actionScales": action_scales,
        "actions": {},
    }
    for name, action in builder.ACTIONS.items():
        manifest["actions"][name] = builder.build_sheet(
            name, action, processed[name], action_scales[name]
        )
        print(f"[brown-bear] built {name}: {manifest['actions'][name]}", flush=True)

    path = ROOT / "sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[brown-bear] manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
