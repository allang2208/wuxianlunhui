#!/usr/bin/env python3
"""Apply the single permitted 2x RIFE pass to the approved death sheet."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
POST = ROOT / "postprocess"


def main() -> None:
    source = json.loads(
        (POST / "approved-death-source-report.json").read_text(encoding="utf-8")
    )
    output_dir = POST / "sheets-rife"
    preview_dir = POST / "previews" / "rife"
    report_dir = POST / "rife-reports"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        str(TOOL),
        "--sheet", str(ROOT / source["sheet"]),
        "--out", str(output_dir / "dying.png"),
        "--name", "trench-assault-dying",
        "--frame-width", str(source["frameWidth"]),
        "--frame-height", str(source["frameHeight"]),
        "--cols", str(source["cols"]),
        "--frame-count", str(source["frameCount"]),
        "--frame-rate", str(source["frameRate"]),
        "--mode", "one-shot",
        "--out-cols", "8",
        "--preview-dir", str(preview_dir),
        "--report", str(report_dir / "dying.json"),
        "--repair-red-outliers",
        "--preserve-vertical-motion",
    ]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
