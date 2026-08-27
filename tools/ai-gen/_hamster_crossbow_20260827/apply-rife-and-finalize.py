#!/usr/bin/env python3
"""Run the required 2x RIFE pass and publish hamster-crossbow runtime assets."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE_TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
RUNTIME_DIR = REPO / "assets" / "companions" / "hamster_crossbow"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-crossbow.png"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--actions",
        nargs="+",
        choices=("idle", "running", "attacking", "dying"),
        help="Only interpolate and publish the named actions.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    selected = tuple(args.actions or source_report["actions"].keys())
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    for action in selected:
        spec = source_report["actions"][action]
        report_path = ROOT / f"{action}-rife-report.json"
        command = [
            sys.executable, str(RIFE_TOOL),
            "--sheet", str(SOURCE_DIR / f"{action}.png"),
            "--out", str(OUTPUT_DIR / f"{action}.png"),
            "--name", f"hamster-crossbow-{action}",
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["frameCount"]),
            "--frame-rate", str(spec["sourceSheetFrameRate"]),
            "--mode", "loop" if spec["repeat"] == -1 else "one-shot",
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
            "--hold-large-repair",
        ]
        subprocess.run(command, check=True)
        shutil.copy2(OUTPUT_DIR / f"{action}.png", RUNTIME_DIR / f"{action}.png")

    if not args.actions:
        shutil.copy2(ROOT / "projectile.png", RUNTIME_DIR / "projectile.png")
    if "idle" in selected:
        idle = Image.open(OUTPUT_DIR / "idle.png").convert("RGBA")
        idle.crop((0, 0, 512, 512)).save(ICON, optimize=True, compress_level=9)


if __name__ == "__main__":
    main()
