#!/usr/bin/env python3
"""Build compact Polar Night Cantor RGBA sheets with one RIFE pass per action."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT.parent / "_frostback_musk_ox_h3_20260901" / "build-formal-sheets.py"
source = TEMPLATE.read_text(encoding="utf-8")
source = source.replace("Frostback Musk Ox", "Polar Night Cantor")
source = source.replace("musk-ox-formal", "polar-night-cantor-formal")
source = source.replace("frostback-musk-ox-", "polar-night-cantor-")
source = source.replace('"asset": "frostback-musk-ox"', '"asset": "polar-night-cantor"')
scope = {"__file__": str(Path(__file__).resolve()), "__name__": "polar_night_cantor_formal_builder"}
exec(compile(source, str(TEMPLATE), "exec"), scope)

idle_ref = ROOT / "references" / "polar-night-cantor-v03-video-safe-1024x576.png"

scope.update({
    "ROOT": ROOT,
    "SOURCE_DIR": ROOT / "spritesheets" / "formal-source-pre-rife",
    "FINAL_DIR": ROOT / "spritesheets" / "formal-final",
    "REPORT_DIR": ROOT / "reports" / "sprites" / "formal-final",
    "PREVIEW_ROOT": ROOT / "previews" / "sprites" / "formal-final",
    "HIGH_HEIGHT": 448,
    "HIGH_FOOT_Y": 408,
    "REFERENCE_BODY_HEIGHT": 300,
    "RUNTIME_TARGET_HEIGHT": 160,
    "RUNTIME_HEIGHT": 208,
    "RUNTIME_FOOT_Y": 188,
    # Scale all four source videos against the approved mother. The generated
    # action keyframes widen the connected bbox with limbs/staff and are direction
    # references, not permission to shrink the runtime body.
    "IDLE_REF": idle_ref,
    "RUN_REF": idle_ref,
    "ATTACK_REF": idle_ref,
    "ACTIONS": {
        "idle": {
            "video": ROOT / "videos" / "polar-night-cantor-idle-doubao-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": [0, 16, 32, 48, 64, 80, 96, 112],
            "anchorMode": "stabilized",
            "rifeMode": "loop",
            "finalCols": 4,
            "durationMs": 5042,
            "repeat": -1,
            "sourceContract": "full Doubao source loop, evenly sampled without clock compression",
        },
        "running": {
            "video": ROOT / "videos" / "polar-night-cantor-running-doubao-v02.mp4",
            "reference": idle_ref,
            "sourceFrames": list(range(21, 49, 2)),
            "anchorMode": "stabilized",
            "rifeMode": "loop",
            "finalCols": 4,
            "durationMs": 1167,
            "repeat": -1,
            "sourceWindow": [21, 49],
            "sourceWindowSemantics": "[21,49), duplicate same-foot-phase endpoint f49 excluded",
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1166.667,
        },
        "attack": {
            "video": ROOT / "videos" / "polar-night-cantor-attacking-doubao-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": list(range(47, 98, 3)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 5,
            "durationMs": 1500,
            "repeat": 0,
            "contactFrame": 2,
            "activeFrames": [2, 10],
            "sourceWindow": [47, 95],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 2000,
            "runtimeTimeScale": 0.75,
            "excludedInvalidLeadRange": [0, 46],
        },
        "death": {
            "video": ROOT / "videos" / "polar-night-cantor-dying-doubao-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": list(range(12, 73, 3)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 5,
            "durationMs": 2500,
            "repeat": 0,
            "sourceWindow": [12, 72],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 2500,
            "settledFromSourceFrame": 64,
        },
    },
})

scope["main"]()

manifest_path = ROOT / "sprite-sheet-manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["actions"]["attack"].update({
    "runtimeTimeScale": 0.75,
    "excludedInvalidLeadRange": [0, 46],
})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
