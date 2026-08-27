#!/usr/bin/env python3
"""Publish approved heavy-machine-gunner RIFE sheets and derive its UI icon."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT / "sheets" / "interpolated"
RUNTIME = REPO / "assets" / "companions" / "hamster_heavy_machine_gunner"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-heavy-machine-gunner.png"


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for action in ("idle", "running", "attacking", "dying"):
        shutil.copy2(SOURCE / f"{action}.png", RUNTIME / f"{action}.png")

    idle = Image.open(SOURCE / "idle.png").convert("RGBA")
    idle.crop((0, 0, 512, 512)).save(ICON, optimize=True, compress_level=9)


if __name__ == "__main__":
    main()
