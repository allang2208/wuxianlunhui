#!/usr/bin/env python3
"""Consolidate the complete four-action trench-assault asset manifest."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
POST = ROOT / "postprocess"


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    runtime = read(ROOT / "runtime-sheet-report.json")
    source_reports = {
        "idle": read(POST / "approved-idle-source-report.json"),
        "running": read(POST / "approved-running-source-report.json"),
        "attacking": read(POST / "approved-attacking-source-report.json"),
        "dying": read(POST / "approved-death-source-report.json"),
    }
    rife_reports = {
        name: read(POST / "rife-reports" / f"{name}.json")
        for name in ("idle", "running", "attacking", "dying")
    }
    audio = read(POST / "attack-audio-report.json")
    actions: dict[str, object] = {}
    previews = {
        "idle": "postprocess/previews/rife/trench-assault-idle-interpolated.gif",
        "running": "postprocess/previews/rife/trench-assault-running-interpolated.gif",
        "attacking": "postprocess/previews/rife/trench-assault-attacking-interpolated.gif",
        "dying": "postprocess/previews/rife/trench-assault-dying-interpolated.gif",
    }
    statuses = {
        "idle": "user_authorized_completion_assistant_offline_passed_formal_asset_installed",
        "running": "user_rejected_firing_take_then_assistant_offline_passed_pure_movement_formal_asset_installed",
        "attacking": "assistant_offline_passed_single_shot_single_pump_formal_asset_installed",
        "dying": "user_approved_formal_asset_installed",
    }
    for name in ("idle", "running", "attacking", "dying"):
        source = source_reports[name]
        rife = rife_reports[name]
        installed = runtime["actions"][name]
        action = {
            "status": statuses[name],
            "sourceVideo": source["source"],
            "sourceIndices": source.get("sourceIndices"),
            "sourceFrameCount": source.get("sourceFrameCount", source.get("frameCount")),
            "rifeMode": rife["mode"],
            "singleRife2xPass": True,
            "finalFrameCount": installed["frameCount"],
            "endFrame": installed["endFrame"],
            "frameRate": installed["frameRate"],
            "repeat": installed["repeat"],
            "durationSeconds": installed["frameCount"] / installed["frameRate"],
            "runtimeAsset": installed["output"],
            "runtimeLayout": {
                "frameWidth": installed["frameWidth"],
                "frameHeight": installed["frameHeight"],
                "cols": installed["cols"],
                "rows": installed["rows"],
                "footYRange": installed["footYRange"],
            },
            "preview": previews[name],
            "gates": {
                "emptyFrames": rife["validation"]["emptyFrames"],
                "touchingFrames": installed["touchingFrames"],
                "originalKeyFramesPreservedAtEvenIndices": rife["validation"]["originalKeyFramesPreservedAtEvenIndices"],
                "nonzeroRgbInTransparentPixels": installed["transparentRgbNonzeroValues"],
                "visibleDarkOutlierFrames": rife["validation"]["visibleDarkOutlierFrames"],
                "visibleRedOutlierFrames": rife["validation"]["visibleRedOutlierFrames"],
                "visibleBlueSpillFrames": rife["validation"]["visibleBlueSpillFrames"],
                "visibleCyanSpillFrames": rife["validation"]["visibleCyanSpillFrames"],
                "heldSourceKeyFallbacks": rife["validation"]["middleFrameHeldSourceKeyFallbacks"],
                "tailToHeadWrap": rife["mode"] == "loop",
            },
            "pngBytes": installed["pngBytes"],
            "sha256": installed["sha256"],
            "decodedMiB": installed["decodedMiB"],
        }
        if name == "running":
            action["stateBoundary"] = "pure movement; no aiming, firing, recoil or pump action"
            action["longTailPolicy"] = "retained under user's earlier explicit instruction"
            action["loopAnalysis"] = "previews/running-loop-analysis-v05/same-phase-candidates.json"
        if name == "attacking":
            action.update({
                "releaseRawSourceFrame": source["releaseRawSourceFrame"],
                "releaseOutputIndex": source["releaseRifeOutputIndex"],
                "releaseDelayMs": source["releaseDelayMs"],
                "pumpPhaseRawFrames": source["pumpPhaseRawFrames"],
                "effectPolicy": source["effectPolicy"],
                "audio": audio["output"],
            })
        actions[name] = action

    manifest = {
        "schemaVersion": 2,
        "date": "2026-09-02",
        "unitKey": "trench_assault",
        "unitName": "战壕突击兵",
        "stage": "four_action_formal_asset_package_runtime_integrated",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "authorizationEvidence": [
            "用户要求：战壕突击兵把他做完。",
            "用户判退移动v03：边跑边开火了，不能用。",
            "用户此前明确允许保留长尾、开枪后烟雾和射击音效。",
        ],
        "actions": actions,
        "audio": audio,
        "budget": runtime["budget"],
        "reports": {
            "sourceReview": "source-review.json",
            "directionReview": "direction-review.md",
            "runtimeSheets": "runtime-sheet-report.json",
            "attackAudio": "postprocess/attack-audio-report.json",
        },
        "runtimeAssetsWritten": True,
        "formalConfigWritten": True,
        "runtimeIntegration": {
            "config": "data/hamster-trench-assault-config.json",
            "publicConfig": "public/data/hamster-trench-assault-config.json",
            "entity": "src/entities/hamster-trench-assault.js",
            "unitKind": "trench_assault",
            "producer": "hamster_barracks",
            "technology": "trench_assault_training",
            "populationCost": 2,
            "attackReleaseOutputIndex": 10,
            "attackLaunchFrameOneBased": 11,
            "attackAnimationDurationMs": 1500,
            "attackIntervalMs": 2400,
            "audio": "assets/sounds/friendly/trench_assault_attack_video.wav",
        },
        "testsRun": False,
    }
    (POST / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "stage": manifest["stage"],
        "actions": {name: {
            "frames": item["finalFrameCount"],
            "fps": item["frameRate"],
            "asset": item["runtimeAsset"],
        } for name, item in actions.items()},
        "budget": manifest["budget"],
        "audio": audio["output"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
