#!/usr/bin/env python3
"""Apply the required RIFE v4.6 2x pass to the accepted snake attack."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_REPORT = ROOT / "reports" / "attacking-v02-source.json"
FINAL_FRAME_COUNT = 41
RUNTIME_DURATION_MS = 900


def main() -> None:
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))["actionData"]
    output = ROOT / "generated" / "final" / "attacking-v02.png"
    preview_dir = ROOT / "previews" / "interpolated"
    report = ROOT / "reports" / "rife" / "attacking-v02.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)

    # This rate makes the generated preview/report describe the 41-frame action
    # on the same 900 ms clock as Phaser. Runtime still uses durationMs directly.
    source_rate = FINAL_FRAME_COUNT * 1000.0 / RUNTIME_DURATION_MS / 2.0
    cmd = [
        sys.executable,
        str(TOOL),
        "--sheet", str(ROOT / "generated" / "source-pre-rife" / "attacking-v02-source.png"),
        "--out", str(output),
        "--name", "brown-snake-attacking-v02",
        "--frame-width", str(source["frameWidth"]),
        "--frame-height", str(source["frameHeight"]),
        "--cols", str(source["columns"]),
        "--frame-count", str(source["frameCount"]),
        "--frame-rate", f"{source_rate:.9f}",
        "--mode", "one-shot",
        "--out-cols", "8",
        "--preview-dir", str(preview_dir),
        "--report", str(report),
        "--repair-red-outliers",
        "--repair-magenta-middle",
    ]
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
