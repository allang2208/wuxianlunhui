#!/usr/bin/env python3
"""Run required RIFE interpolation and publish hamster-longbow runtime assets."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE_TOOL = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SOURCE_DIR = ROOT / "source-sheets-pre-interpolation"
OUTPUT_DIR = ROOT / "sheets" / "interpolated"
PREVIEW_DIR = ROOT / "previews" / "interpolated"
RUNTIME_DIR = REPO / "assets" / "companions" / "hamster_longbow"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-longbow.png"
PROJECTILE = ROOT / "projectile" / "hamster-longbow-projectile-final-512.png"


def main() -> None:
    source_report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    for action, spec in source_report["actions"].items():
        report_path = ROOT / f"{action}-rife-report.json"
        command = [
            sys.executable, str(RIFE_TOOL),
            "--sheet", str(SOURCE_DIR / f"{action}.png"),
            "--out", str(OUTPUT_DIR / f"{action}.png"),
            "--name", f"hamster-longbow-{action}",
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
        shutil.copy2(OUTPUT_DIR / f"{action}.png", RUNTIME_DIR / f"{action}.png")

    shutil.copy2(PROJECTILE, RUNTIME_DIR / "projectile.png")
    idle = Image.open(OUTPUT_DIR / "idle.png").convert("RGBA")
    frame_width = source_report["actions"]["idle"]["frameWidth"]
    first = idle.crop((0, 0, frame_width, 512))
    bbox = first.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("idle frame 0 is empty")
    crop = first.crop(bbox)
    scale = min(448 / crop.width, 448 / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    icon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    icon.alpha_composite(resized, ((512 - resized.width) // 2, (512 - resized.height) // 2))
    icon.save(ICON, optimize=True, compress_level=9)

    source_report["runtimeIntegration"] = True
    source_report["runtimeAssetDirectory"] = "assets/companions/hamster_longbow"
    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(source_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
