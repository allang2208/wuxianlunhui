#!/usr/bin/env python3
"""Copy the approved hamster-sniper sheets and derive its runtime icon."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RUNTIME = REPO / "assets" / "companions" / "hamster_sniper"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-sniper.png"
REJECTED_RUNTIME = ROOT / "rejected-runtime"
CELL = 512


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ICON.parent.mkdir(parents=True, exist_ok=True)
    REJECTED_RUNTIME.mkdir(parents=True, exist_ok=True)
    previous_running = RUNTIME / "running.png"
    previous_backup = REJECTED_RUNTIME / "running-v03.png"
    if previous_running.is_file() and not previous_backup.exists():
        shutil.copy2(previous_running, previous_backup)
    sources = {
        "idle": ROOT / "sheets" / "interpolated" / "idle.png",
        "running": ROOT / "sheets" / "interpolated" / "running-h3-v02.png",
        "attacking": ROOT / "sheets" / "interpolated" / "attacking.png",
        "dying": ROOT / "sheets" / "interpolated" / "dying.png",
    }
    for action, source in sources.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        shutil.copy2(source, RUNTIME / f"{action}.png")

    idle = Image.open(sources["idle"]).convert("RGBA")
    idle.crop((0, 0, CELL, CELL)).save(ICON, optimize=True, compress_level=9)
    print(f"[sniper-finalize] runtime={RUNTIME}")
    print(f"[sniper-finalize] icon={ICON}")


if __name__ == "__main__":
    main()
