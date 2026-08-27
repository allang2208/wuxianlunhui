#!/usr/bin/env python3
"""Apply the mandatory RIFE v4.6 gate and write the final treant sheet manifest."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE_SCRIPT = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
RAW_MANIFEST = ROOT / "raw-sheet-manifest.json"
FINAL_DIR = ROOT / "generated" / "final"
PREVIEW_DIR = ROOT / "previews" / "final"
REPORT_DIR = ROOT / "reports" / "rife"

SETTINGS = {
    "idle": {"mode": "loop", "sourceFrameRate": 6.0},
    "walking": {"mode": "loop", "sourceFrameRate": 8.0},
    "attacking": {"mode": "one-shot", "sourceFrameRate": 12.0},
    "dying": {"mode": "one-shot", "sourceFrameRate": 8.0},
}


def main() -> None:
    raw = json.loads(RAW_MANIFEST.read_text(encoding="utf-8"))
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    final = {
        "asset": "evil-treant",
        "displayName": "邪恶树精",
        "pipeline": "MiniMax H3 -> BiRefNet-general -> fixed-scale sheets -> RIFE v4.6 RGBA 2x",
        "sourceVideo": {
            name: f"video/evil-treant-{name}-h3.mp4"
            for name in ("idle", "walking", "attacking", "dying")
        },
        "background": raw["background"],
        "normalization": raw["normalization"],
        "targetNeutralHeight": raw["targetNeutralHeight"],
        "rootAnchor": raw["rootAnchor"],
        "footY": raw["footY"],
        "runtimeInstalled": False,
        "actions": {},
    }
    for name, settings in SETTINGS.items():
        action = raw["actions"][name]
        source_sheet = ROOT / action["file"]
        output_sheet = FINAL_DIR / f"{name}.png"
        report_path = REPORT_DIR / f"{name}.json"
        preview_name = f"evil-treant-{name}"
        command = [
            sys.executable,
            str(RIFE_SCRIPT),
            "--sheet", str(source_sheet),
            "--out", str(output_sheet),
            "--name", preview_name,
            "--frame-width", str(action["frameWidth"]),
            "--frame-height", str(action["frameHeight"]),
            "--cols", str(action["columns"]),
            "--frame-count", str(action["frameCount"]),
            "--frame-rate", str(settings["sourceFrameRate"]),
            "--mode", settings["mode"],
            "--out-cols", "8",
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report_path),
        ]
        print("$ " + " ".join(command), flush=True)
        subprocess.run(command, check=True)
        report = json.loads(report_path.read_text(encoding="utf-8"))
        result = {
            "file": str(output_sheet.relative_to(ROOT)),
            "rawSheet": action["file"],
            "previewGif": str((PREVIEW_DIR / f"{preview_name}-interpolated.gif").relative_to(ROOT)),
            "contactSheet": str((PREVIEW_DIR / f"{preview_name}-interpolated-contact.png").relative_to(ROOT)),
            "rifeReport": str(report_path.relative_to(ROOT)),
            "frameWidth": action["frameWidth"],
            "frameHeight": action["frameHeight"],
            "columns": report["cols"],
            "rows": report["rows"],
            "frameCount": report["outputFrameCount"],
            "endFrame": report["outputFrameCount"] - 1,
            "frameRate": report["outputFrameRate"],
            "footY": action["footY"],
            "referenceCell": 512,
            "repeat": action["repeat"],
            "sourceFrames": action["sourceFrames"],
            "sourceFrameCount": report["sourceFrameCount"],
            "rifeMode": report["mode"],
            "validation": report["validation"],
        }
        if "contactFrame" in action:
            result["rawContactFrame"] = action["contactFrame"]
            result["contactFrame"] = action["contactFrame"] * 2
            result["contactSourceFrame"] = action["contactSourceFrame"]
        final["actions"][name] = result

    manifest_path = ROOT / "sprite-sheet-manifest.json"
    manifest_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[evil-treant] final manifest -> {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
