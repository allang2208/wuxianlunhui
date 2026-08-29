#!/usr/bin/env python3
"""Apply 2x RIFE to the Black-Lung Lamp Keeper's MiniMax source sheets."""

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
ACTIONS = {
    "walking": {"count": 31, "mode": "loop"},
    "pickaxeSlam": {"count": 31, "mode": "one-shot"},
    "blackLungCough": {"count": 31, "mode": "one-shot"},
    "lanternOverload": {"count": 31, "mode": "one-shot"},
    "dying": {"count": 21, "mode": "one-shot"},
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "2x RIFE from authored 6fps keys to 12fps; original keys preserved at even indices",
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
            "--frame-width", "640",
            "--frame-height", "640",
            "--cols", "8",
            "--frame-count", str(spec["count"]),
            "--frame-rate", "6",
            "--mode", str(spec["mode"]),
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
            "--repair-red-outliers",
            "--repair-magenta-middle",
        ]
        if name == "dying":
            # The fastest collapse pair can create a large transient colour
            # block.  Use the tool's pair-local source-key fallback only when
            # its explicit residual-artifact gate fires.
            command.append("--hold-large-repair")
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    (ROOT / "interpolation-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[black-lung-rife] wrote {ROOT / 'interpolation-report.json'}")


if __name__ == "__main__":
    main()
