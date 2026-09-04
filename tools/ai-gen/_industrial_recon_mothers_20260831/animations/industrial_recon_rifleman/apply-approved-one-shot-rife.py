#!/usr/bin/env python3
"""Apply one 2x RIFE pass to approved recon attack/death sheets."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
POST = ROOT / "postprocess"
SOURCE_DIR = POST / "source-sheets-pre-rife"
OUTPUT_DIR = POST / "sheets-rife"
PREVIEW_DIR = POST / "previews" / "rife"
REPORT_DIR = POST / "rife-reports"


def main() -> None:
    source_report = json.loads((POST / "approved-one-shot-source-report.json").read_text(encoding="utf-8"))
    combined_path = POST / "rife-report.json"
    combined = json.loads(combined_path.read_text(encoding="utf-8"))
    combined["policy"] = (
        "one 2x RIFE pass; loop source keys remain at even indices with closing seam; "
        "one-shot source keys remain at even indices and never wrap"
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("attacking", "dying"):
        spec = source_report["actions"][name]
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(OUTPUT_DIR / f"{name}.png"),
            "--name", f"industrial-recon-rifleman-{name}",
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["frameCount"]),
            "--frame-rate", str(spec["frameRate"]),
            "--mode", "one-shot",
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
        ]
        if name == "dying":
            command.append("--preserve-vertical-motion")
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))
    combined_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(combined, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
