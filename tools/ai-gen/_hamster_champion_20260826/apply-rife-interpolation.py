#!/usr/bin/env python3
"""Apply the mandatory 2x RIFE import pass to all hamster champion actions."""

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
ASSET_DIR = REPO / "assets" / "companions" / "hamster_champion"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
REPORT_DIR = ROOT / "interpolation-reports"
SOURCE_REPORT = ROOT / "source-sheet-report.json"
MODES = {
    "idle": "loop",
    "running": "loop",
    "attacking": "one-shot",
    "dying": "one-shot",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", choices=tuple(MODES))
    args = parser.parse_args()
    source = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined_path = ROOT / "interpolation-report.json"
    combined: dict[str, object] = json.loads(combined_path.read_text(encoding="utf-8")) if combined_path.exists() else {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "all imported monster and friendly-unit animation sheets require this pass",
        "actions": {},
    }

    for name, mode in MODES.items():
        if args.only and name not in args.only:
            continue
        spec = source["actions"][name]
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(ASSET_DIR / f"{name}.png"),
            "--name", name,
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["frameCount"]),
            "--frame-rate", str(spec["frameRate"]),
            "--mode", mode,
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
        ]
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    combined_path.write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[champion-rife] wrote {ROOT / 'interpolation-report.json'}")


if __name__ == "__main__":
    main()
