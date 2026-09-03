#!/usr/bin/env python3
"""Apply 2x RIFE to the Sealed-Shaft Rock Wraith source sheets."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
REPORT_DIR = ROOT / "interpolation-reports"
MODES = {
    "idle": "loop",
    "walking": "loop",
    "crystalArmSmash": "one-shot",
    "borequake": "one-shot",
    "drillRush": "one-shot",
    "dying": "one-shot",
}


def main() -> None:
    source_report = json.loads(
        (ROOT / "source-sheet-report.json").read_text(encoding="utf-8")
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "2x RIFE from authored 6fps keys to 12fps; source keys preserved at even indices",
        "actions": {},
    }
    for name, mode in MODES.items():
        layout = source_report["actions"][name]
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(OUTPUT_DIR / f"{name}.png"),
            "--name", name,
            "--frame-width", str(layout["frameWidth"]),
            "--frame-height", str(layout["frameHeight"]),
            "--cols", str(layout["cols"]),
            "--frame-count", str(layout["frameCount"]),
            "--frame-rate", "6",
            "--mode", mode,
            "--out-cols", str(layout["cols"]),
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
            "--repair-magenta-middle",
        ]
        if name in {"drillRush", "dying"}:
            command.append("--hold-large-repair")
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    (ROOT / "interpolation-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[sealed-wraith-rife] wrote {ROOT / 'interpolation-report.json'}")


if __name__ == "__main__":
    main()
