#!/usr/bin/env python3
"""Apply the mandatory one-shot RIFE 2x gate to the V2 treant death sheet."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RAW_MANIFEST = ROOT / "dying-fracture-v02-raw-manifest.json"
RIFE_SCRIPT = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
FINAL_DIR = ROOT / "generated" / "v02" / "final"
PREVIEW_DIR = ROOT / "previews" / "v02" / "final"
REPORT_DIR = ROOT / "reports" / "v02" / "rife"
FINAL_MANIFEST = ROOT / "dying-fracture-v02-sprite-manifest.json"


def main() -> None:
    raw = json.loads(RAW_MANIFEST.read_text(encoding="utf-8"))
    action = raw["action"]
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    output_sheet = FINAL_DIR / "dying.png"
    report_path = REPORT_DIR / "dying.json"
    command = [
        sys.executable,
        str(RIFE_SCRIPT),
        "--sheet", str(ROOT / action["file"]),
        "--out", str(output_sheet),
        "--name", "evil-treant-dying-fracture-v02",
        "--frame-width", str(action["frameWidth"]),
        "--frame-height", str(action["frameHeight"]),
        "--cols", str(action["columns"]),
        "--frame-count", str(action["frameCount"]),
        "--frame-rate", str(action["frameCount"] / (action["duration"] / 1000.0)),
        "--mode", "one-shot",
        "--out-cols", "8",
        "--preview-dir", str(PREVIEW_DIR),
        "--report", str(report_path),
    ]
    print("$ " + " ".join(command), flush=True)
    subprocess.run(command, check=True)
    report = json.loads(report_path.read_text(encoding="utf-8"))

    manifest = {
        "asset": "evil-treant",
        "variant": "dying-fracture-v02",
        "pipeline": "MiniMax H3 -> BiRefNet multi-component cutout -> fixed-scale sheet -> RIFE v4.6 RGBA 2x",
        "runtimeInstalled": False,
        "sourceVideo": raw["sourceVideo"],
        "rawSheet": action["file"],
        "file": str(output_sheet.relative_to(ROOT)),
        "previewGif": str((PREVIEW_DIR / "evil-treant-dying-fracture-v02-interpolated.gif").relative_to(ROOT)),
        "contactSheet": str((PREVIEW_DIR / "evil-treant-dying-fracture-v02-interpolated-contact.png").relative_to(ROOT)),
        "rifeReport": str(report_path.relative_to(ROOT)),
        "frameWidth": action["frameWidth"],
        "frameHeight": action["frameHeight"],
        "columns": report["cols"],
        "rows": report["rows"],
        "frameCount": report["outputFrameCount"],
        "endFrame": report["outputFrameCount"] - 1,
        "frameRate": report["outputFrameRate"],
        "duration": action["duration"],
        "footY": action["footY"],
        "referenceCell": 512,
        "repeat": 0,
        "sourceFrames": action["sourceFrames"],
        "validation": report["validation"],
    }
    FINAL_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[evil-treant-v02] final manifest -> {FINAL_MANIFEST}", flush=True)


if __name__ == "__main__":
    main()
