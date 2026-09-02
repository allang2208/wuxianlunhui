#!/usr/bin/env python3
"""Apply the required single 2x RIFE pass to task-local steel-shield sheets."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
POST = ROOT / "postprocess"
SOURCE_DIR = POST / "source-sheets-pre-rife"
OUTPUT_DIR = POST / "sheets-rife"
PREVIEW_DIR = POST / "previews" / "rife-tool"
REPORT_DIR = POST / "rife-reports"
SOURCE_REPORT = POST / "formal-source-report.json"
COMBINED_REPORT = POST / "formal-rife-report.json"
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
CLEANER = ROOT / "clean-formal-rife-edges.py"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--action", action="append", choices=("idle", "running", "attacking", "dying"),
        help="interpolate only the named action; may be repeated",
    )
    args = parser.parse_args()
    selected = set(args.action or ())
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    if selected and COMBINED_REPORT.exists():
        combined = json.loads(COMBINED_REPORT.read_text(encoding="utf-8"))
    else:
        combined: dict[str, object] = {
            "schemaVersion": 1,
            "date": "2026-09-01",
            "unitKey": "steel_shield_assault",
            "assetOnly": True,
            "runtimeIntegration": False,
            "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
            "policy": "one 2x RIFE pass; loops wrap once, one-shots never wrap; death preserves authored vertical collapse",
            "actions": {},
        }

    for name, spec in source["actions"].items():
        if selected and name not in selected:
            continue
        mode = "loop" if spec["repeat"] == -1 else "one-shot"
        output_path = OUTPUT_DIR / f"{name}.png"
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable, str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(output_path),
            "--name", name,
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["sourceFrameCount"]),
            "--frame-rate", str(spec["sourceSheetFrameRate"]),
            "--mode", mode,
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
        ]
        if spec.get("preserveVerticalMotionDuringRife"):
            command.append("--preserve-vertical-motion")
        subprocess.run(command, check=True)
        action_report = json.loads(report_path.read_text(encoding="utf-8"))
        action_report.update({
            "status": "formal_asset_candidate_pending_visual_review",
            "sourceVideo": spec["source"],
            "sourceIndices": spec["sourceIndices"],
            "outputSheet": str(output_path.relative_to(ROOT)).replace("\\", "/"),
            "runtimeFrameRate": spec["runtimeFrameRate"],
            "runtimeDurationMs": spec["finalFrameCount"] / spec["runtimeFrameRate"] * 1000,
            "expectedFrameCount": spec["finalFrameCount"],
        })
        if name == "attacking":
            action_report.update({
                "releaseOutputIndex": spec["releaseRifeOutputIndex"],
                "releaseDelayMs": spec["releaseDelayMs"],
                "attackDurationMs": 1500,
                "approvedFlashAndSmokeRetainedInSourceSheet": True,
            })
        if name == "dying":
            action_report.update({
                "finalCorpseOutputIndex": spec["finalCorpseOutputIndex"],
                "finalCorpseMustHold": True,
            })
        report_path.write_text(json.dumps(action_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        combined["actions"][name] = action_report

    COMBINED_REPORT.write_text(json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    clean_command = [sys.executable, str(CLEANER)]
    for name in sorted(selected):
        clean_command.extend(("--action", name))
    subprocess.run(clean_command, check=True)
    print(f"[steel-shield] wrote {COMBINED_REPORT}")


if __name__ == "__main__":
    main()
