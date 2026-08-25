#!/usr/bin/env python3
"""Apply the mandatory 2x RIFE import pass to all halberdier actions."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
ASSET_DIR = REPO / "assets" / "companions" / "hamster_halberdier"
BACKUP_DIR = ROOT / "source-sheets-pre-interpolation"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
REPORT_DIR = ROOT / "interpolation-reports"
ACTIONS = {
    "idle": {"count": 24, "rate": 8, "mode": "loop"},
    "running": {"count": 15, "rate": 12, "mode": "loop"},
    "attacking": {"count": 20, "rate": 12, "mode": "one-shot"},
    "dying": {"count": 16, "rate": 12, "mode": "one-shot"},
}


def main() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "tool": "tools/ai-gen/rife-spritesheet-interpolate.py",
        "policy": "all imported monster and friendly-unit animation sheets require this pass",
        "actions": {},
    }
    for name, spec in ACTIONS.items():
        runtime_sheet = ASSET_DIR / f"{name}.png"
        backup_sheet = BACKUP_DIR / f"{name}.png"
        source_sheet = backup_sheet if backup_sheet.exists() else runtime_sheet
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable,
            str(TOOL),
            "--sheet", str(source_sheet),
            "--out", str(runtime_sheet),
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
        ]
        if not backup_sheet.exists():
            command.extend(["--backup", str(backup_sheet)])
        subprocess.run(command, check=True)
        combined["actions"][name] = json.loads(report_path.read_text(encoding="utf-8"))

    (ROOT / "interpolation-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[halberdier-rife] wrote {ROOT / 'interpolation-report.json'}")


if __name__ == "__main__":
    main()
