#!/usr/bin/env python3
"""Apply one permitted 2x one-shot RIFE pass to the approved attack sheet."""

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
        (POST / "approved-attacking-source-report.json").read_text(encoding="utf-8")
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
        "--out", str(output_dir / "attacking.png"),
        "--name", "trench-assault-attacking",
        "--frame-width", str(source["frameWidth"]),
        "--frame-height", str(source["frameHeight"]),
        "--cols", str(source["cols"]),
        "--frame-count", str(source["sourceFrameCount"]),
        "--frame-rate", str(source["sourceSheetFrameRate"]),
        "--mode", "one-shot",
        "--out-cols", "8",
        "--preview-dir", str(preview_dir),
        "--report", str(report_dir / "attacking.json"),
    ], check=True)


if __name__ == "__main__":
    main()
