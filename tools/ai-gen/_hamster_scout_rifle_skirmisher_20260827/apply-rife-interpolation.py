#!/usr/bin/env python3
"""Apply the mandatory RIFE 2x pass to the five accepted runtime source sheets."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only",
        choices=("idle", "moving", "moving_attacking", "standing_attacking", "dying"),
    )
    args = parser.parse_args()
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    report_path = ROOT / "interpolation-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "pipeline": "RIFE v4.6 RGBA 2x",
        "actions": {},
    }

    for action, spec in source_report["actions"].items():
        if args.only and action != args.only:
            continue
        output = ROOT / "sheets" / "interpolated" / f"{action}.png"
        preview_dir = ROOT / "previews" / "interpolated"
        action_report = ROOT / "interpolation-reports" / f"{action}.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        preview_dir.mkdir(parents=True, exist_ok=True)
        action_report.parent.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(ROOT / "source-sheets-pre-interpolation" / f"{action}.png"),
            "--out", str(output),
            "--name", f"hamster-scout-rifle-skirmisher-{action}",
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["frameCount"]),
            "--frame-rate", str(spec["sourceSheetFrameRate"]),
            "--mode", "loop" if spec["repeat"] == -1 else "one-shot",
            "--out-cols", "8",
            "--preview-dir", str(preview_dir),
            "--report", str(action_report),
            "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)
        report["actions"][action] = json.loads(action_report.read_text(encoding="utf-8"))

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
