#!/usr/bin/env python3
"""Apply one permitted 2x loop RIFE pass to the approved movement sheet."""

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
        (POST / "approved-running-source-report.json").read_text(encoding="utf-8")
    )
    output_dir = POST / "sheets-rife"
    preview_dir = POST / "previews" / "rife"
    report_dir = POST / "rife-reports"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        sys.executable, str(TOOL),
        "--sheet", str(ROOT / source["sheet"]),
        "--out", str(output_dir / "running.png"),
        "--name", "trench-assault-running",
        "--frame-width", str(source["frameWidth"]),
        "--frame-height", str(source["frameHeight"]),
        "--cols", str(source["cols"]),
        "--frame-count", str(source["frameCount"]),
        "--frame-rate", str(source["frameRate"]),
        "--mode", "loop",
        "--out-cols", "8",
        "--preview-dir", str(preview_dir),
        "--report", str(report_dir / "running.json"),
        "--repair-red-outliers",
    ], check=True)


if __name__ == "__main__":
    main()
