#!/usr/bin/env python3
"""Build accepted MiniMax H3 idle, walking, and dying source sheets."""

from __future__ import annotations

import importlib.util
import json
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE_BUILDER = ROOT / "build-sheets.py"
TARGET_BODY_THICKNESS = 88.0

ACTIONS = {
    "idle-v02-source": {
        "action": "idle",
        "candidate": "v02-raised",
        "video": ROOT / "video" / "brown-snake-idle-h3-v02-raised.mp4",
        "frames": list(range(0, 120, 10)),
        "cols": 6,
        "mode": "source_motion_grounded",
        "frameRate": 4,
        "repeat": -1,
        "normalizationFrames": list(range(0, 120, 10)),
    },
    "walking-v06-source": {
        "action": "walking",
        "candidate": "v06-semi-coiled-crawl-loop",
        "video": ROOT / "video" / "brown-snake-walking-h3-v06-semi-coiled-crawl-loop.mp4",
        "frames": list(range(0, 120, 6)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
        "normalizationFrames": list(range(0, 120, 6)),
    },
    "dying-v02-source": {
        "action": "dying",
        "candidate": "v02-raised-collapse",
        "video": ROOT / "video" / "brown-snake-dying-h3-v02-raised-collapse.mp4",
        "frames": list(range(0, 61, 4)) + [72, 96],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
        # Match the first raised guard pose to the accepted attack/idle body thickness;
        # keep one fixed scale through the complete collapse.
        "normalizationFrames": [0],
    },
}


def load_builder():
    spec = importlib.util.spec_from_file_location("brown_snake_base_builder", BASE_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {BASE_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    builder = load_builder()
    builder.OUT_DIR = ROOT / "generated" / "source-pre-rife"
    builder.PREVIEW_DIR = ROOT / "previews" / "source"
    builder.OUT_DIR.mkdir(parents=True, exist_ok=True)
    builder.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    decoded = {name: builder.decode(spec["video"]) for name, spec in ACTIONS.items()}
    for name, frames in decoded.items():
        if len(frames) != 124:
            raise ValueError(f"{name}: expected 124 frames, got {len(frames)}")

    model = builder.get_model()
    actions_report = {}
    for name, spec in ACTIONS.items():
        processed = builder.process_frames(model, decoded[name], spec["frames"], name)
        source_thicknesses = []
        for frame_index in spec["normalizationFrames"]:
            source_thicknesses.append(builder.body_thickness(processed[frame_index][1]))
        source_thickness = float(statistics.median(source_thicknesses))
        scale = TARGET_BODY_THICKNESS / source_thickness
        build_spec = {
            key: value
            for key, value in spec.items()
            if key not in {"action", "candidate", "normalizationFrames"}
        }
        action_data = builder.build_sheet(name, build_spec, processed, scale)
        # The source-clock GIF is a disposable review cache, not a formal archive input.
        action_data.pop("preview", None)
        actions_report[spec["action"]] = {
            "candidate": spec["candidate"],
            "accepted": True,
            "sourceVideo": str(spec["video"].relative_to(ROOT)).replace("\\", "/"),
            "normalization": "fixed per-action scale from local snake body thickness; pose bbox excluded",
            "targetBodyThickness": TARGET_BODY_THICKNESS,
            "normalizationSourceFrames": spec["normalizationFrames"],
            "normalizationBodyThicknesses": source_thicknesses,
            "normalizationMedianBodyThickness": source_thickness,
            "actionScale": scale,
            "actionData": action_data,
        }
        print(json.dumps({spec["action"]: actions_report[spec["action"]]}, indent=2), flush=True)

    report = {
        "asset": "brown_snake",
        "builder": BASE_BUILDER.name,
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "runtimeIntegrated": True,
        "actions": actions_report,
    }
    output = ROOT / "reports" / "nonattack-v02-sources.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[brown-snake] report -> {output}", flush=True)


if __name__ == "__main__":
    main()
