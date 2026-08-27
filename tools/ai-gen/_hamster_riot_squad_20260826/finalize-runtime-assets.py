#!/usr/bin/env python3
"""Copy approved hamster-riot-squad sheets into runtime assets and derive its icon."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RUNTIME = REPO / "assets" / "companions" / "hamster_riot_squad"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-riot-squad.png"
CELL = 512


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ICON.parent.mkdir(parents=True, exist_ok=True)
    sources = {
        "idle": ROOT / "sheets" / "interpolated" / "idle.png",
        "walking": ROOT / "sheets" / "interpolated" / "walking.png",
        "attacking": ROOT / "sheets" / "interpolated" / "attacking.png",
        "dying": ROOT / "sheets" / "interpolated" / "dying.png",
    }
    for action, source in sources.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        shutil.copy2(source, RUNTIME / f"{action}.png")

    idle = Image.open(sources["idle"]).convert("RGBA")
    idle.crop((0, 0, CELL, CELL)).save(ICON, optimize=True, compress_level=9)
    print(f"[riot-finalize] runtime={RUNTIME}")
    print(f"[riot-finalize] icon={ICON}")


if __name__ == "__main__":
    main()
