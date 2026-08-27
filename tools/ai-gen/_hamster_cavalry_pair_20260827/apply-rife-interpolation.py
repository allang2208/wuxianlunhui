#!/usr/bin/env python3
"""Apply the mandatory 2x RIFE pass to both approved cavalry units."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
REPORT_DIR = ROOT / "interpolation-reports"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", choices=("cavalry", "winged_hussar"))
    parser.add_argument("--only", choices=("idle", "running", "attacking", "dying"))
    args = parser.parse_args()

    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    combined_path = ROOT / "interpolation-report.json"
    if (args.unit or args.only) and combined_path.exists():
        combined: dict[str, object] = json.loads(combined_path.read_text(encoding="utf-8"))
    else:
        combined = {
            "assetOnly": True,
            "runtimeIntegration": False,
            "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
            "policy": "all accepted friendly-unit animation sheets require RIFE v4.6 2x",
            "units": {},
        }

    for unit, unit_spec in source_report["actions"].items():
        if args.unit and unit != args.unit:
            continue
        unit_reports: dict[str, object] = dict(combined["units"].get(unit, {}))
        for action, spec in unit_spec["actions"].items():
            if args.only and action != args.only:
                continue
            output_dir = OUTPUT_DIR / unit
            preview_dir = PREVIEW_DIR / unit
            report_dir = REPORT_DIR / unit
            output_dir.mkdir(parents=True, exist_ok=True)
            preview_dir.mkdir(parents=True, exist_ok=True)
            report_dir.mkdir(parents=True, exist_ok=True)
            report_path = report_dir / f"{action}.json"
            command = [
                sys.executable,
                str(TOOL),
                "--sheet", str(SOURCE_DIR / unit / f"{action}.png"),
                "--out", str(output_dir / f"{action}.png"),
                "--name", f"hamster-{unit.replace('_', '-')}-{action}",
                "--frame-width", str(spec["frameWidth"]),
                "--frame-height", str(spec["frameHeight"]),
                "--cols", str(spec["cols"]),
                "--frame-count", str(spec["frameCount"]),
                "--frame-rate", str(spec["sourceSheetFrameRate"]),
                "--mode", "loop" if spec["repeat"] == -1 else "one-shot",
                "--out-cols", "8",
                "--preview-dir", str(preview_dir),
                "--report", str(report_path),
                "--repair-red-outliers",
            ]
            subprocess.run(command, check=True)
            unit_reports[action] = json.loads(report_path.read_text(encoding="utf-8"))
        combined["units"][unit] = unit_reports

    combined_path.write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[cavalry-pair-rife] wrote {combined_path}")


if __name__ == "__main__":
    main()
