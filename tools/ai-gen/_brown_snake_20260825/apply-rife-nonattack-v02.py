#!/usr/bin/env python3
"""Apply the required RIFE v4.6 2x pass to accepted non-attack actions."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_REPORT = ROOT / "reports" / "nonattack-v02-sources.json"

ACTIONS = {
    "idle": {
        "source": "idle-v02-source.png",
        "output": "idle-v02.png",
        "name": "brown-snake-idle-v02",
        "mode": "loop",
        "sourceFrameRate": 4.0,
        "outCols": 6,
        "report": "idle-v02.json",
    },
    "walking": {
        "source": "walking-v06-source.png",
        "output": "walking-v06.png",
        "name": "brown-snake-walking-v06",
        "mode": "loop",
        "sourceFrameRate": 12.0,
        "outCols": 5,
        "report": "walking-v06.json",
    },
    "dying": {
        "source": "dying-v02-source.png",
        "output": "dying-v02.png",
        "name": "brown-snake-dying-v02",
        "mode": "one-shot",
        "runtimeDurationMs": 1800,
        "outCols": 6,
        "report": "dying-v02.json",
    },
}


def main() -> None:
    source_report = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    output_dir = ROOT / "generated" / "final"
    preview_dir = ROOT / "previews" / "interpolated"
    report_dir = ROOT / "reports" / "rife"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    for action, spec in ACTIONS.items():
        source = source_report["actions"][action]["actionData"]
        source_count = int(source["frameCount"])
        if spec["mode"] == "loop":
            source_rate = float(spec["sourceFrameRate"])
        else:
            output_count = source_count * 2 - 1
            source_rate = output_count * 1000.0 / float(spec["runtimeDurationMs"]) / 2.0
        cmd = [
            sys.executable,
            str(TOOL),
            "--sheet", str(ROOT / "generated" / "source-pre-rife" / spec["source"]),
            "--out", str(output_dir / spec["output"]),
            "--name", spec["name"],
            "--frame-width", str(source["frameWidth"]),
            "--frame-height", str(source["frameHeight"]),
            "--cols", str(source["columns"]),
            "--frame-count", str(source_count),
            "--frame-rate", f"{source_rate:.9f}",
            "--mode", spec["mode"],
            "--out-cols", str(spec["outCols"]),
            "--preview-dir", str(preview_dir),
            "--report", str(report_dir / spec["report"]),
            "--repair-red-outliers",
            "--repair-magenta-middle",
        ]
        subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
