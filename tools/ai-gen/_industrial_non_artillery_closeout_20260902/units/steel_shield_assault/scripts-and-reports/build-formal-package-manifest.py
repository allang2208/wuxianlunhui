#!/usr/bin/env python3
"""Write the review manifest for the task-local steel-shield formal package."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
POST = ROOT / "postprocess"
SOURCE_REPORT = POST / "formal-source-report.json"
RIFE_REPORT = POST / "formal-rife-report.json"
PREVIEW_REPORT = POST / "formal-preview-report.json"
AUDIO_REPORT = ROOT / "audio" / "steel-shield-assault-attack.json"
EDGE_CLEANUP_REPORT = POST / "formal-rife-edge-cleanup-report.json"
WHITE_EDGE_REPORT = POST / "white-edge-report.json"
OUTPUT = POST / "formal-package-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_info(path: Path) -> dict[str, object]:
    return {
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    rife = json.loads(RIFE_REPORT.read_text(encoding="utf-8"))
    preview = json.loads(PREVIEW_REPORT.read_text(encoding="utf-8"))
    audio = json.loads(AUDIO_REPORT.read_text(encoding="utf-8"))
    edge_cleanup = json.loads(EDGE_CLEANUP_REPORT.read_text(encoding="utf-8"))
    white_edge = json.loads(WHITE_EDGE_REPORT.read_text(encoding="utf-8"))
    actions: dict[str, object] = {}
    for name, spec in source["actions"].items():
        sheet_path = POST / "sheets-rife" / f"{name}.png"
        gif_path = POST / "previews" / "runtime-clock-exact" / f"{name}.gif"
        width, height = Image.open(sheet_path).size
        final = rife["actions"][name]
        expected_width = 8 * spec["frameWidth"]
        expected_height = final["rows"] * spec["frameHeight"]
        if (width, height) != (expected_width, expected_height):
            raise RuntimeError(
                f"{name} sheet is {width}x{height}, expected {expected_width}x{expected_height}"
            )
        if final["outputFrameCount"] != spec["finalFrameCount"]:
            raise RuntimeError(f"{name} frame-count mismatch")
        action: dict[str, object] = {
            "sourceVideo": file_info(ROOT / spec["source"]),
            "formalSheet": file_info(sheet_path),
            "previewGif": file_info(gif_path),
            "frameWidth": spec["frameWidth"],
            "frameHeight": spec["frameHeight"],
            "cols": 8,
            "rows": final["rows"],
            "frameCount": spec["finalFrameCount"],
            "frameRate": spec["runtimeFrameRate"],
            "durationMs": preview["actions"][name]["nominalDurationMs"],
            "repeat": spec["repeat"],
            "fixedActionScale": spec["fixedActionScale"],
            "fixedSourceAnchor": spec["fixedSourceAnchor"],
            "rifeOriginalKeyFramesPreservedBeforeEdgeCleanup": final["validation"]["originalKeyFramesPreservedAtEvenIndices"],
            "postRifeEdgeCleanupApplied": edge_cleanup["actions"][name]["totalPixelsRecolored"] > 0,
            "postRifeWhitePixelsRecolored": edge_cleanup["actions"][name]["totalPixelsRecolored"],
            "whiteEdgeMaximumRatioAfterCleanup": white_edge["formalRifeSheets"][name]["maximumFrameWhiteishRatio"],
            "emptyFrames": final["validation"]["emptyFrames"],
            "touchingFrames": final["validation"]["touchingFrames"],
            "nonzeroRgbInTransparentPixels": final["validation"]["nonzeroRgbInTransparentPixels"],
        }
        if name == "running":
            action["loopSelection"] = spec["loopSelection"]
            action["groundContactMattePixelsRemoved"] = edge_cleanup["actions"][name]["totalGroundContactMattePixelsRemoved"]
            action["footEdgeContact"] = file_info(
                POST / "previews" / "foot-edge-review" / "running-feet-contact.png"
            )
            action["loopSeamContact"] = file_info(
                POST / "previews" / "runtime-clock-exact" / "running-loop-seam-contact.png"
            )
        if name == "attacking":
            action.update({
                "releaseRawSourceFrame": spec["releaseRawSourceFrame"],
                "releaseOutputIndex": spec["releaseRifeOutputIndex"],
                "releaseDelayMs": spec["releaseDelayMs"],
                "flashAndSmokeRetained": True,
                "groundContactMattePixelsRemoved": edge_cleanup["actions"][name]["totalGroundContactMattePixelsRemoved"],
                "footEdgeContact": file_info(
                    POST / "previews" / "foot-edge-review" / "attacking-feet-contact.png"
                ),
                "releaseSmokeContact": file_info(
                    POST / "previews" / "runtime-clock-exact" / "attacking-release-smoke-contact.png"
                ),
            })
        if name == "dying":
            action.update({
                "finalCorpseOutputIndex": spec["finalCorpseOutputIndex"],
                "finalCorpseHoldPolicy": "one-shot freezes on final frame",
                "finalContact": file_info(
                    POST / "previews" / "runtime-clock-exact" / "dying-final-contact.png"
                ),
            })
        actions[name] = action

    manifest = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "unitName": "钢盾突击兵",
        "status": "formal_asset_package_user_confirmed_runtime_integrated",
        "userConfirmedCompleteAt": "2026-09-02",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "targetEffectiveBodyHeight": source["targetEffectiveBodyHeight"],
        "scaleContract": source["scaleContract"],
        "actions": actions,
        "attackAudio": {
            **file_info(ROOT / audio["output"]),
            "durationSeconds": audio["durationSeconds"],
            "sampleRate": audio["sampleRate"],
            "channels": audio["channels"],
            "bitRate": audio["bitRate"],
            "peakDbfs": audio["peakDbfs"],
            "rmsDbfs": audio["rmsDbfs"],
            "plannedReleaseOutputIndex": audio["plannedRuntimeReleaseFrameZeroBased"],
            "plannedReleaseDelayMs": audio["plannedRuntimeReleaseDelayMs"],
        },
        "decodedBudget": {
            "bytes": source["totalDecodedBytes"],
            "miB": source["totalDecodedMiB"],
            "targetMiB": source["crowdTargetMiB"],
            "admissionMiB": source["admissionMiB"],
            "withinTarget": source["withinTarget"],
            "withinAdmission": source["withinAdmission"],
        },
        "pipeline": {
            "cutout": "BiRefNet-general plus white-studio matte cleanup",
            "interpolation": "one RIFE v4.6 2x pass",
            "postInterpolationEdgeCleanup": "moving and attack remove the pale connected ground-contact matte below boots/shield; nearest opaque actor colour replaces any remaining RIFE white semi-alpha contamination",
            "attackTiming": "49 frames / 1500 ms; release at output frame 18 / about 551 ms",
            "runtimeConfigWritten": True,
        },
        "whiteEdgeScreen": {
            "report": file_info(WHITE_EDGE_REPORT),
            "passes": white_edge["passes"],
            "failures": white_edge["failures"],
            "maximumRatiosByAction": {
                name: white_edge["formalRifeSheets"][name]["maximumFrameWhiteishRatio"]
                for name in source["actions"]
            },
            "neutralFootMatteMaximumPixelsByFrame": {
                name: white_edge["formalRifeSheets"][name]["neutralFootMattePixelsMaximumFrame"]
                for name in ("running", "attacking")
            },
            "approvedAttackEffectExcludedByAlignedMask": True,
        },
        "testsRun": False,
        "offlineChecks": "sheet geometry, frame counts, alpha empties/touches, transparent RGB, exact-clock preview timing, event contacts, decoded budget, source and post-RIFE white-edge hard screen",
    }
    OUTPUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
