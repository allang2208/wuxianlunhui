#!/usr/bin/env python3
"""Apply mandatory 2x RIFE to the accepted hamster-phalanx source sheets."""

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
ACTIONS = {
    "idle": {"count": 12, "rate": 8, "mode": "loop"},
    "walking": {"count": 31, "rate": 6, "mode": "loop"},
    "attacking": {"count": 21, "rate": 12, "mode": "one-shot"},
    "dying": {"count": 16, "rate": 10, "mode": "one-shot"},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=tuple(ACTIONS))
    args = parser.parse_args()
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined_path = ROOT / "interpolation-report.json"
    if combined_path.exists():
        combined = json.loads(combined_path.read_text(encoding="utf-8"))
    else:
        combined = {
            "assetOnly": True,
            "runtimeIntegration": False,
            "acceptedMovementSource": "walking v02; all running candidates excluded",
            "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
            "policy": "all accepted friendly-unit animation sheets require RIFE v4.6 2x",
            "actions": {},
        }
    selected = {args.action: ACTIONS[args.action]} if args.action else ACTIONS
    for name, spec in selected.items():
        source_sheet = SOURCE_DIR / f"{name}.png"
        output_sheet = OUTPUT_DIR / f"{name}.png"
        report_path = REPORT_DIR / f"{name}.json"
        frame_width = source_report["actions"][name]["frameWidth"]
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(source_sheet),
            "--out", str(output_sheet),
            "--name", name,
            "--frame-width", str(frame_width),
            "--frame-height", "512",
            "--cols", "8",
            "--frame-count", str(spec["count"]),
            "--frame-rate", str(spec["rate"]),
            "--mode", str(spec["mode"]),
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    combined_path.write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[phalanx-rife] wrote {combined_path}")


if __name__ == "__main__":
    main()
