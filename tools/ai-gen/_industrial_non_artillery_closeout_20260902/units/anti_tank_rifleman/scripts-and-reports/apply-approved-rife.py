#!/usr/bin/env python3
"""Apply one required 2x RIFE pass to all approved anti-tank animations."""

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
    source_report = json.loads((POST / "approved-source-report.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "anti_tank_rifleman",
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "one 2x RIFE pass; approved source keys remain at even output indices; loops interpolate the closing seam; one-shots never wrap",
        "actions": {},
    }
    for name in ("idle", "running", "attacking", "grenade_throw", "dying"):
        spec = source_report["actions"][name]
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(OUTPUT_DIR / f"{name}.png"),
            "--name", f"anti-tank-rifleman-{name.replace('_', '-')}",
            "--frame-width", str(spec["frameWidth"]),
            "--frame-height", str(spec["frameHeight"]),
            "--cols", str(spec["cols"]),
            "--frame-count", str(spec["frameCount"]),
            "--frame-rate", str(spec["frameRate"]),
            "--mode", str(spec["mode"]),
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
        ]
        if name == "dying":
            command.append("--preserve-vertical-motion")
        subprocess.run(command, check=True)
        result = json.loads(report_path.read_text(encoding="utf-8"))
        if name == "grenade_throw":
            result["releaseRawSourceFrame"] = spec["releaseRawSourceFrame"]
            result["releaseSourceSheetIndex"] = spec["releaseSourceSheetIndex"]
            result["releaseRifeOutputIndex"] = spec["releaseRifeOutputIndex"]
        combined["actions"][name] = result

    (POST / "rife-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(combined, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
