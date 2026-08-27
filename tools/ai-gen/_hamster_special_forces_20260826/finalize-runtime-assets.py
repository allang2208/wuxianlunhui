#!/usr/bin/env python3
"""Publish approved hamster-special-forces sheets and derive its UI icon."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT / "sheets" / "interpolated"
RUNTIME = REPO / "assets" / "companions" / "hamster_special_forces"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-special-forces.png"


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    mapping = {
        "idle": "idle",
        "running": "walking",
        "attacking": "attacking",
        "dying": "dying",
    }
    for source_name, runtime_name in mapping.items():
        shutil.copy2(SOURCE / f"{source_name}.png", RUNTIME / f"{runtime_name}.png")

    idle = Image.open(SOURCE / "idle.png").convert("RGBA")
    idle.crop((0, 0, 512, 512)).save(ICON, optimize=True, compress_level=9)


if __name__ == "__main__":
    main()
