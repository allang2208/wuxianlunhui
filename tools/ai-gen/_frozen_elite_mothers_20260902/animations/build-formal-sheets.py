#!/usr/bin/env python3
"""Build the five frozen-elite four-action RGBA sprite families.

The implementation deliberately reuses the accepted Frostback Musk Ox builder:
BiRefNet cutout, fixed per-action crop, one 2x RIFE pass, compact cells, runtime
clock GIFs, contact sheets, and quantitative manifests all stay on the same
pipeline as the five normal frozen-dungeon families.
"""

from __future__ import annotations

import json
import shutil
import argparse
import sys
from pathlib import Path


ANIM_ROOT = Path(__file__).resolve().parent
TASK_ROOT = ANIM_ROOT.parent
REPO_ROOT = TASK_ROOT.parents[2]
TOOLS = REPO_ROOT / "tools" / "ai-gen"
TEMPLATE = TOOLS / "_frostback_musk_ox_h3_20260901" / "build-formal-sheets.py"
RIFE_EXE = (REPO_ROOT.parent / "_tmp" / "elise_audit" / "rife"
            / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe")


UNITS = {
    "ice-crown-lynx": {
        "displayName": "Ice Crown Lynx",
        "runtimeTargetHeight": 176,
        "reference": ANIM_ROOT / "references" / "ice-crown-lynx-mother-video-safe-1024x576.png",
        "actions": {
            "idle": {
                "video": ANIM_ROOT / "videos" / "ice-crown-lynx" / "idle-doubao-v01.mp4",
                "sourceFrames": list(range(0, 121, 16)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 5042, "repeat": -1,
                "sourceWindow": [0, 120], "sourceContract": "full accepted idle, evenly sampled",
            },
            "running": {
                "video": ANIM_ROOT / "videos" / "ice-crown-lynx" / "running-doubao-v01.mp4",
                "sourceFrames": list(range(23, 67, 2)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 5, "durationMs": 1833, "repeat": -1,
                "scaleMultiplier": 0.912,
                "sourceWindow": [23, 67], "sourceWindowSemantics": "[23,67), same-phase endpoint excluded",
            },
            "attack": {
                "video": ANIM_ROOT / "videos" / "ice-crown-lynx" / "attacking-doubao-v01.mp4",
                "sourceFrames": list(range(12, 112, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 1500, "repeat": 0,
                "scaleMultiplier": 0.953,
                "sourceWindow": [12, 108], "contactFrame": 34, "activeFrames": [32, 36],
            },
            "death": {
                "video": ANIM_ROOT / "videos" / "ice-crown-lynx" / "dying-doubao-v01.mp4",
                "sourceFrames": list(range(0, 100, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 3000, "repeat": 0,
                "sourceWindow": [0, 96], "settledFromSourceFrame": 76,
            },
        },
    },
    "glacierback-war-ox": {
        "displayName": "Glacierback War Ox",
        "runtimeTargetHeight": 184,
        "reference": ANIM_ROOT / "references" / "glacierback-war-ox-mother-video-safe-1024x576.png",
        "actions": {
            "idle": {
                "video": ANIM_ROOT / "videos" / "glacierback-war-ox" / "idle-doubao-v01.mp4",
                "sourceFrames": list(range(0, 121, 16)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 5042, "repeat": -1,
                "sourceWindow": [0, 120], "sourceContract": "full accepted idle, evenly sampled",
            },
            "running": {
                "video": ANIM_ROOT / "videos" / "glacierback-war-ox" / "running-doubao-v01.mp4",
                "sourceFrames": list(range(13, 43, 2)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 5, "durationMs": 1250, "repeat": -1,
                "scaleMultiplier": 1.04,
                "sourceWindow": [13, 43], "sourceWindowSemantics": "[13,43), same-hoof endpoint excluded",
            },
            "attack": {
                "video": ANIM_ROOT / "videos" / "glacierback-war-ox" / "attacking-doubao-v02.mp4",
                "sourceFrames": list(range(20, 108, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 1700, "repeat": 0,
                "scaleMultiplier": 1.148,
                "sourceWindow": [20, 104], "contactFrame": 28, "activeFrames": [26, 30],
            },
            "death": {
                "video": ANIM_ROOT / "videos" / "glacierback-war-ox" / "dying-doubao-v01.mp4",
                "sourceFrames": list(range(0, 100, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 3200, "repeat": 0,
                "scaleMultiplier": 0.928,
                "sourceWindow": [0, 96], "settledFromSourceFrame": 76,
            },
        },
    },
    "abyss-crystal-ravager": {
        "displayName": "Abyss Crystal Ravager",
        "runtimeTargetHeight": 176,
        "reference": ANIM_ROOT / "references" / "abyss-crystal-ravager-mother-video-safe-1024x576.png",
        "actions": {
            "idle": {
                "video": ANIM_ROOT / "videos" / "abyss-crystal-ravager" / "idle-doubao-v01.mp4",
                "sourceFrames": list(range(0, 121, 16)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 5042, "repeat": -1,
                "sourceWindow": [0, 120], "sourceContract": "full accepted idle, evenly sampled",
            },
            "running": {
                "video": ANIM_ROOT / "videos" / "abyss-crystal-ravager" / "running-doubao-v04.mp4",
                "sourceFrames": list(range(55, 87, 2)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 1333, "repeat": -1,
                "sourceWindow": [55, 87], "sourceWindowSemantics": "[55,87), full same-phase gait endpoint excluded",
            },
            "attack": {
                "video": ANIM_ROOT / "videos" / "abyss-crystal-ravager" / "attacking-doubao-v03.mp4",
                "sourceFrames": list(range(12, 108, 5)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 1800, "repeat": 0,
                "scaleMultiplier": 0.909,
                "sourceWindow": [12, 107], "contactFrame": 18, "activeFrames": [16, 20],
            },
            "death": {
                "video": ANIM_ROOT / "videos" / "abyss-crystal-ravager" / "dying-doubao-v08-folding-form.mp4",
                "sourceFrames": list(range(0, 96, 5)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 3000, "repeat": 0,
                "scaleMultiplier": 0.96,
                "sourceWindow": [0, 95], "settledFromSourceFrame": 75,
            },
        },
    },
    "frostbound-centurion": {
        "displayName": "Frostbound Centurion",
        "runtimeTargetHeight": 176,
        "runtimeHeight": 272,
        "runtimeFootY": 248,
        "reference": ANIM_ROOT / "references" / "frostbound-centurion-mother-video-safe-1024x576.png",
        "actions": {
            "idle": {
                "video": ANIM_ROOT / "videos" / "frostbound-centurion" / "idle-doubao-v02-side-lock.mp4",
                "sourceFrames": list(range(0, 121, 16)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 5042, "repeat": -1,
                "sourceWindow": [0, 120], "sourceContract": "full accepted idle, evenly sampled",
            },
            "running": {
                "video": ANIM_ROOT / "videos" / "frostbound-centurion" / "running-doubao-v02-side-lock.mp4",
                "sourceFrames": list(range(58, 110, 2)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 5, "durationMs": 2167, "repeat": -1,
                "sourceWindow": [58, 110], "sourceWindowSemantics": "[58,110), same-step endpoint excluded",
            },
            "attack": {
                "video": ANIM_ROOT / "videos" / "frostbound-centurion" / "attacking-doubao-v03-margin-lock.mp4",
                "sourceFrames": list(range(0, 100, 4)), "anchorMode": "stabilized",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 1600, "repeat": 0,
                "scaleMultiplier": 0.87,
                "sourceWindow": [0, 96], "contactFrame": 28, "activeFrames": [26, 30],
                "rootPolicy": "lower-body/torso stabilized; spear extension stays in-sheet and no code lunge is added",
            },
            "death": {
                "video": ANIM_ROOT / "videos" / "frostbound-centurion" / "dying-doubao-v03-folding-form.mp4",
                "sourceFrames": list(range(0, 100, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 3000, "repeat": 0,
                "scaleMultiplier": 0.793,
                "sourceWindow": [0, 96], "settledFromSourceFrame": 87,
            },
        },
    },
    "polar-night-high-priest": {
        "displayName": "Polar Night High Priest",
        "runtimeTargetHeight": 180,
        "runtimeHeight": 288,
        "runtimeFootY": 264,
        "reference": ANIM_ROOT / "references" / "polar-night-high-priest-mother-video-safe-1024x576.png",
        "actions": {
            "idle": {
                "video": ANIM_ROOT / "videos" / "polar-night-high-priest" / "idle-doubao-v01.mp4",
                "sourceFrames": list(range(0, 121, 16)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 4, "durationMs": 5042, "repeat": -1,
                "sourceWindow": [0, 120], "sourceContract": "full accepted idle, evenly sampled",
            },
            "running": {
                "video": ANIM_ROOT / "videos" / "polar-night-high-priest" / "running-doubao-v01.mp4",
                "sourceFrames": list(range(69, 99, 2)), "anchorMode": "stabilized",
                "rifeMode": "loop", "finalCols": 5, "durationMs": 1250, "repeat": -1,
                "sourceWindow": [69, 99], "sourceWindowSemantics": "[69,99), same-step endpoint excluded",
            },
            "attack": {
                "video": ANIM_ROOT / "videos" / "polar-night-high-priest" / "attacking-doubao-v01.mp4",
                "sourceFrames": list(range(0, 96, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 1500, "repeat": 0,
                "sourceWindow": [0, 92], "contactFrame": 16, "activeFrames": [16, 18],
                "releaseFrame": 16, "reuse": "shared attack/cast animation for all three novice spells",
            },
            "death": {
                "video": ANIM_ROOT / "videos" / "polar-night-high-priest" / "dying-h3-v01.mp4",
                "sourceFrames": list(range(26, 102, 4)), "anchorMode": "source",
                "rifeMode": "one-shot", "finalCols": 5, "durationMs": 3167, "repeat": 0,
                "scaleMultiplier": 1.28,
                "sourceWindow": [26, 98], "settledFromSourceFrame": 90,
            },
        },
    },
}


def build_unit(slug: str, unit: dict) -> dict:
    source = TEMPLATE.read_text(encoding="utf-8")
    source = source.replace("Frostback Musk Ox", unit["displayName"])
    source = source.replace("musk-ox-formal", f"{slug}-formal")
    source = source.replace("frostback-musk-ox", slug)
    source = source.replace("1024 / 2", "HIGH_WIDTH / 2")
    source = source.replace("x, y, 1024, HIGH_HEIGHT", "x, y, HIGH_WIDTH, HIGH_HEIGHT")
    scale_line = "multipliers[action] = idle_ref_width / (ref_box[2] - ref_box[0] + 1)"
    replacement = (
        "multipliers[action] = (idle_ref_width / (ref_box[2] - ref_box[0] + 1) "
        "* float(spec.get(\"scaleMultiplier\", 1.0)))"
    )
    if scale_line not in source:
        raise RuntimeError("shared formal builder scale hook changed")
    source = source.replace(scale_line, replacement)
    scope = {
        "__file__": str(TEMPLATE.resolve()),
        "__name__": f"frozen_elite_{slug.replace('-', '_')}_builder",
    }
    exec(compile(source, str(TEMPLATE), "exec"), scope)

    unit_root = ANIM_ROOT / "spritesheets" / slug
    reference = unit["reference"]
    actions = unit["actions"]
    for spec in actions.values():
        spec["reference"] = reference
        spec.setdefault("sourceVideoFps", 24)

    scope.update({
        "ROOT": ANIM_ROOT,
        "REPO": REPO_ROOT,
        "TOOLS": TOOLS,
        "RIFE_TOOL": TOOLS / "rife-spritesheet-interpolate.py",
        "RIFE_EXE": RIFE_EXE,
        "SOURCE_DIR": unit_root / "formal-source-pre-rife",
        "FINAL_DIR": unit_root / "formal-final",
        "REPORT_DIR": unit_root / "reports",
        "PREVIEW_ROOT": unit_root / "previews",
        "HIGH_HEIGHT": 512,
        "HIGH_WIDTH": 1152,
        "HIGH_FOOT_Y": 464,
        "REFERENCE_BODY_HEIGHT": 352,
        "RUNTIME_TARGET_HEIGHT": unit["runtimeTargetHeight"],
        "RUNTIME_HEIGHT": unit.get("runtimeHeight", 240),
        "RUNTIME_FOOT_Y": unit.get("runtimeFootY", 216),
        "IDLE_REF": reference,
        "RUN_REF": reference,
        "ATTACK_REF": reference,
        "ACTIONS": actions,
    })
    argv = sys.argv
    try:
        sys.argv = [str(Path(__file__).resolve())]
        scope["main"]()
    finally:
        sys.argv = argv

    generated_manifest = ANIM_ROOT / "sprite-sheet-manifest.json"
    manifest_path = unit_root / "manifest.json"
    shutil.move(str(generated_manifest), str(manifest_path))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["budgetTier"] = "specialist"
    manifest["runtimeIntegrationActive"] = False
    manifest["status"] = "formal-four-action-assets-built-offline"
    manifest["directionReference"] = str((ANIM_ROOT / "direction-reference.md").relative_to(ANIM_ROOT)).replace("\\", "/")
    manifest["normalFamilyReference"] = str(reference.relative_to(ANIM_ROOT)).replace("\\", "/")
    for action, spec in actions.items():
        entry = manifest["actions"][action]
        for key in ("releaseFrame", "reuse", "rootPolicy"):
            if key in spec:
                entry[key] = spec[key]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", choices=tuple(UNITS), action="append")
    args = parser.parse_args()
    selected = args.unit or list(UNITS)
    manifests = {slug: build_unit(slug, UNITS[slug]) for slug in selected}
    for slug in UNITS:
        manifest_path = ANIM_ROOT / "spritesheets" / slug / "manifest.json"
        if slug not in manifests and manifest_path.exists():
            manifests[slug] = json.loads(manifest_path.read_text(encoding="utf-8"))
    total = sum(int(item["decodedRgbaBytes"]) for item in manifests.values())
    combined = {
        "task": "frozen-dungeon-five-elite-formal-sprites",
        "stage": "formal-assets-built-offline",
        "budgetTier": "specialist-per-unit",
        "interpolationPasses": 1,
        "units": {
            slug: {
                "manifest": f"spritesheets/{slug}/manifest.json",
                "decodedRgbaMiB": item["decodedRgbaMiB"],
                "withinSpecialistTarget64MiB": int(item["decodedRgbaBytes"]) <= 64 * 1024 * 1024,
                "actions": {name: {
                    "frameWidth": action["frameWidth"],
                    "frameHeight": action["frameHeight"],
                    "frameCount": action["frameCount"],
                    "endFrame": action["endFrame"],
                    "durationMs": action["durationMs"],
                    "footX": action["footX"],
                    "footY": action["footY"],
                } for name, action in item["actions"].items()},
            } for slug, item in manifests.items()
        },
        "combinedDecodedRgbaMiB": round(total / 1024 / 1024, 4),
        "runtimeTested": False,
        "gameIntegrated": False,
    }
    (ANIM_ROOT / "formal-sprite-manifest.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(combined, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
