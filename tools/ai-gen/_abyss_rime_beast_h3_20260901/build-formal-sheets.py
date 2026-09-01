#!/usr/bin/env python3
"""Build compact Abyss Rime Beast RGBA sheets with the validated one-RIFE workflow."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT.parent / "_frostback_musk_ox_h3_20260901" / "build-formal-sheets.py"

# Reuse the already validated packer without copying its implementation. The
# source is evaluated against this task's __file__, then only task-specific
# identity, scale, timing, and source windows are replaced below.
source = TEMPLATE.read_text(encoding="utf-8")
source = source.replace("Frostback Musk Ox", "Abyss Rime Beast")
source = source.replace("musk-ox-formal", "rime-beast-formal")
source = source.replace("frostback-musk-ox-", "abyss-rime-beast-")
source = source.replace('"asset": "frostback-musk-ox"', '"asset": "abyss-rime-beast"')

scope = {
    "__file__": str(Path(__file__).resolve()),
    "__name__": "abyss_rime_beast_formal_builder",
}
exec(compile(source, str(TEMPLATE), "exec"), scope)

idle_ref = ROOT / "references" / "abyss-rime-beast-idle-keyframe-v01-1024x576.png"
run_ref = ROOT / "references" / "abyss-rime-beast-running-keyframe-v01-1024x576.png"
attack_ref = ROOT / "references" / "abyss-rime-beast-attacking-keyframe-v01-1024x576.png"

scope.update({
    "ROOT": ROOT,
    "SOURCE_DIR": ROOT / "spritesheets" / "formal-source-pre-rife",
    "FINAL_DIR": ROOT / "spritesheets" / "formal-final",
    "REPORT_DIR": ROOT / "reports" / "sprites" / "formal-final",
    "PREVIEW_ROOT": ROOT / "previews" / "sprites" / "formal-final",
    "HIGH_HEIGHT": 416,
    "HIGH_FOOT_Y": 356,
    "REFERENCE_BODY_HEIGHT": 260,
    "RUNTIME_TARGET_HEIGHT": 130,
    "RUNTIME_HEIGHT": 176,
    "RUNTIME_FOOT_Y": 160,
    "IDLE_REF": idle_ref,
    "RUN_REF": run_ref,
    "ATTACK_REF": attack_ref,
    "ACTIONS": {
        "idle": {
            "video": ROOT / "videos" / "abyss-rime-beast-idle-h3-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": [0, 16, 32, 48, 64, 80, 96, 112],
            "anchorMode": "stabilized",
            "rifeMode": "loop",
            "finalCols": 4,
            "durationMs": 5170,
            "repeat": -1,
            "sourceContract": "full H3 first/last-frame loop, evenly sampled without clock compression",
        },
        "running": {
            "video": ROOT / "videos" / "abyss-rime-beast-running-h3-v01.mp4",
            "reference": run_ref,
            "sourceFrames": list(range(84, 114, 2)),
            "anchorMode": "stabilized",
            "rifeMode": "loop",
            "finalCols": 3,
            "durationMs": 1250,
            "repeat": -1,
            "sourceWindow": [84, 114],
            "sourceWindowSemantics": "[84,114), duplicate same-foot-phase endpoint f114 excluded",
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1250,
        },
        "attack": {
            "video": ROOT / "videos" / "abyss-rime-beast-attacking-h3-v01.mp4",
            "reference": attack_ref,
            "sourceFrames": list(range(68, 97, 2)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 3,
            "durationMs": 1167,
            "repeat": 0,
            "contactFrame": 22,
            "activeFrames": [18, 25],
            # Preserve the bite through the active window, then ease the visual
            # root back to neutral with whole-cell integer translations only.
            "frameTranslationsX": {26: -4, 27: -9, 28: -15},
            "sourceWindow": [68, 96],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1166.667,
            "excludedRepeatedStrikeRanges": [[98, 123]],
        },
        "death": {
            "video": ROOT / "videos" / "abyss-rime-beast-dying-h3-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": list(range(0, 33, 2)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 3,
            "durationMs": 1333,
            "repeat": 0,
            "sourceWindow": [0, 32],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1333.333,
            "settledFromSourceFrame": 32,
        },
    },
})

scope["main"]()
