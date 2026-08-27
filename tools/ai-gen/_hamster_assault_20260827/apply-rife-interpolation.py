#!/usr/bin/env python3
"""Apply the mandatory 2x RIFE pass to hamster-assault source sheets."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
REPORT_DIR = ROOT / "interpolation-reports"


def main() -> None:
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "all accepted friendly-unit animation sheets require RIFE v4.6 2x",
        "actions": {},
    }

    for name, spec in source_report["actions"].items():
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(OUTPUT_DIR / f"{name}.png"),
            "--name", f"hamster-assault-{name}",
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
        ]
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    (ROOT / "interpolation-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[hamster-assault-rife] wrote {ROOT / 'interpolation-report.json'}")


if __name__ == "__main__":
    main()
