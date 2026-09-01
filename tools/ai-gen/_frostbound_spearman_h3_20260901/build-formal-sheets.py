#!/usr/bin/env python3
"""Build compact Frostbound Spearman RGBA sheets with the validated one-RIFE workflow."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT.parent / "_frostback_musk_ox_h3_20260901" / "build-formal-sheets.py"
source = TEMPLATE.read_text(encoding="utf-8")
source = source.replace("Frostback Musk Ox", "Frostbound Spearman")
source = source.replace("musk-ox-formal", "frostbound-spearman-formal")
source = source.replace("frostback-musk-ox-", "frostbound-spearman-")
source = source.replace('"asset": "frostback-musk-ox"', '"asset": "frostbound-spearman"')
scope = {"__file__": str(Path(__file__).resolve()), "__name__": "frostbound_spearman_formal_builder"}
exec(compile(source, str(TEMPLATE), "exec"), scope)

idle_ref = ROOT / "references" / "frostbound-spearman-idle-keyframe-v01-1024x576.png"
run_ref = ROOT / "references" / "frostbound-spearman-running-keyframe-v01-1024x576.png"
attack_ref = ROOT / "references" / "frostbound-spearman-attacking-keyframe-v01-1024x576.png"

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
    "IDLE_REF": idle_ref,
    "RUN_REF": run_ref,
    "ATTACK_REF": attack_ref,
    "ACTIONS": {
        "idle": {
            "video": ROOT / "videos" / "frostbound-spearman-idle-h3-v01.mp4",
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
            "video": ROOT / "videos" / "frostbound-spearman-running-h3-v01.mp4",
            "reference": run_ref,
            "sourceFrames": list(range(61, 92, 2)),
            "anchorMode": "stabilized",
            "rifeMode": "loop",
            "finalCols": 4,
            "durationMs": 1292,
            "repeat": -1,
            "sourceWindow": [61, 92],
            "sourceWindowSemantics": "[61,92), duplicate same-foot-phase endpoint f92 excluded",
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1291.667,
        },
        "attack": {
            "video": ROOT / "videos" / "frostbound-spearman-attacking-h3-v01.mp4",
            "reference": attack_ref,
            "sourceFrames": list(range(14, 75, 3)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 5,
            "durationMs": 1500,
            "repeat": 0,
            "contactFrame": 10,
            "activeFrames": [10, 22],
            "sourceWindow": [14, 74],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 2500,
            "runtimeAnchorX": 104,
            "runtimeTimeScale": 0.6,
            "excludedRepeatedStrikeRanges": [[80, 123]],
        },
        "death": {
            "video": ROOT / "videos" / "frostbound-spearman-dying-h3-v01.mp4",
            "reference": idle_ref,
            "sourceFrames": list(range(28, 73, 2)),
            "anchorMode": "source",
            "rifeMode": "one-shot",
            "finalCols": 5,
            "durationMs": 1833,
            "repeat": 0,
            "sourceWindow": [28, 72],
            "sourceVideoFps": 24,
            "sourceWallClockMs": 1833.333,
            "settledFromSourceFrame": 72,
        },
    },
})

scope["main"]()

# The H3 frame itself keeps its natural two-foot stance off the cell center.
# Runtime uses the median support-foot midpoint as the logical X root; this is a
# constant whole-frame anchor, not per-frame recentering or image scaling.
manifest_path = ROOT / "sprite-sheet-manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["actions"]["attack"].update({
    "footX": 104,
    "anchorX": 104,
    "runtimeTimeScale": 0.6,
})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
