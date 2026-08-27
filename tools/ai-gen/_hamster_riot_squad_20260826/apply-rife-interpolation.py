#!/usr/bin/env python3
"""Apply mandatory 2x RIFE interpolation to hamster-riot-squad source sheets."""

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
ACTIONS = {
    "idle": {"count": 12, "rate": 8, "mode": "loop"},
    "walking": {"count": 31, "rate": 6, "mode": "loop"},
    "attacking": {"count": 21, "rate": 12, "mode": "one-shot"},
    "dying": {"count": 16, "rate": 10, "mode": "one-shot"},
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "all accepted friendly-unit animation sheets require RIFE v4.6 2x",
        "actions": {},
    }
    for name, spec in ACTIONS.items():
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(SOURCE_DIR / f"{name}.png"),
            "--out", str(OUTPUT_DIR / f"{name}.png"),
            "--name", name,
            "--frame-width", "512",
            "--frame-height", "512",
            "--cols", "8",
            "--frame-count", str(spec["count"]),
            "--frame-rate", str(spec["rate"]),
            "--mode", str(spec["mode"]),
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
        ]
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    output = ROOT / "interpolation-report.json"
    output.write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[riot-rife] wrote {output}")


if __name__ == "__main__":
    main()
