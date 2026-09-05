#!/usr/bin/env python3
"""Apply the required RIFE v4.6 RGBA 2x pass to all approved source sheets."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE_TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
ACTION_NAMES = ("idle", "moving", "spellcast", "dying")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--actions",
        nargs="+",
        choices=ACTION_NAMES,
        default=list(ACTION_NAMES),
        help="Only rebuild the named actions; defaults to all four.",
    )
    args = parser.parse_args()
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for action in args.actions:
        spec = source_report["actions"][action]
        command = [
            sys.executable,
            str(RIFE_TOOL),
            "--sheet",
            str(SOURCE_DIR / f"{action}.png"),
            "--out",
            str(OUTPUT_DIR / f"{action}.png"),
            "--name",
            f"hamster-archbishop-shared-{action}",
            "--frame-width",
            str(spec["frameWidth"]),
            "--frame-height",
            str(spec["frameHeight"]),
            "--cols",
            str(spec["cols"]),
            "--frame-count",
            str(spec["frameCount"]),
            "--frame-rate",
            str(spec["sourceSheetFrameRate"]),
            "--mode",
            "loop" if spec["repeat"] == -1 else "one-shot",
            "--out-cols",
            "8",
            "--preview-dir",
            str(PREVIEW_DIR),
            "--report",
            str(ROOT / f"{action}-rife-report.json"),
            "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
