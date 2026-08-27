#!/usr/bin/env python3
"""Apply mandatory RIFE v4.6 interpolation to all purple ancient actions."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
RAW = ROOT / "raw-sheet-manifest.json"
FINAL_DIR = ROOT / "generated" / "final"
PREVIEW_DIR = ROOT / "previews" / "final"
REPORT_DIR = ROOT / "reports" / "rife"
SETTINGS = {
    "idle": {"mode": "loop", "frameRate": 4.0},
    "spellcast": {"mode": "one-shot", "frameRate": 16 / 1.7},
    "attack": {"mode": "one-shot", "frameRate": 16 / 1.5},
    "throw": {"mode": "one-shot", "frameRate": 10.0},
    "death": {"mode": "one-shot", "frameRate": 16 / 2.2},
}


def main(only: str | None = None) -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "sprite-sheet-manifest.json"
    if only is not None and manifest_path.exists():
        final = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        final = {
            "asset": "purple-blight-ancient",
            "displayName": "紫蚀古树",
            "pipeline": "Doubao Seedance -> BiRefNet-general -> fixed-root sheets -> RIFE v4.6 RGBA 2x",
            "runtimeInstalled": False,
            "actions": {},
        }
    for name, settings in SETTINGS.items():
        if only is not None and name != only:
            continue
        action = raw["actions"][name]
        output = FINAL_DIR / f"{name}.png"
        report_path = REPORT_DIR / f"{name}.json"
        command = [
            sys.executable, str(RIFE),
            "--sheet", str(ROOT / action["file"]),
            "--out", str(output),
            "--name", f"purple-blight-ancient-{name}",
            "--frame-width", str(action["frameWidth"]),
            "--frame-height", str(action["frameHeight"]),
            "--cols", str(action["columns"]),
            "--frame-count", str(action["frameCount"]),
            "--frame-rate", str(settings["frameRate"]),
            "--mode", settings["mode"],
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
        ]
        subprocess.run(command, check=True)
        report = json.loads(report_path.read_text(encoding="utf-8"))
        result = {
            "file": str(output.relative_to(ROOT)),
            "rawSheet": action["file"],
            "previewGif": str((PREVIEW_DIR / f"purple-blight-ancient-{name}-interpolated.gif").relative_to(ROOT)),
            "contactSheet": str((PREVIEW_DIR / f"purple-blight-ancient-{name}-interpolated-contact.png").relative_to(ROOT)),
            "rifeReport": str(report_path.relative_to(ROOT)),
            "frameWidth": action["frameWidth"],
            "frameHeight": action["frameHeight"],
            "columns": report["cols"],
            "rows": report["rows"],
            "frameCount": report["outputFrameCount"],
            "frameRate": report["outputFrameRate"],
            "footY": action["footY"],
            "repeat": action["repeat"],
            "sourceFrames": action["sourceFrames"],
            "rifeMode": report["mode"],
            "validation": report["validation"],
        }
        if "contactFrame" in action:
            result["rawContactFrame"] = action["contactFrame"]
            result["contactFrame"] = action["contactFrame"] * 2
            result["contactSourceFrame"] = action["contactSourceFrame"]
        final["actions"][name] = result
    manifest_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(SETTINGS))
    args = parser.parse_args()
    main(args.only)
