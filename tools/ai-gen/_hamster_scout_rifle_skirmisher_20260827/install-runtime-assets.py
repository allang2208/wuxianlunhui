#!/usr/bin/env python3
"""Install the approved RIFE sheets and derive the recruitment icon."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TARGET = REPO / "assets" / "companions" / "hamster_scout_rifle_skirmisher"


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    sources = {
        "idle.png": "idle.png",
        "running.png": "moving.png",
        "moving-attacking.png": "moving_attacking.png",
        "attacking.png": "standing_attacking.png",
        "dying.png": "dying.png",
    }
    for target_name, source_name in sources.items():
        shutil.copy2(ROOT / "sheets" / "interpolated" / source_name, TARGET / target_name)

    idle = Image.open(TARGET / "idle.png").convert("RGBA")
    first_frame = idle.crop((0, 0, 512, 512))
    bbox = first_frame.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("idle frame 0 is empty")
    subject = first_frame.crop(bbox)
    scale = min(232 / subject.width, 232 / subject.height)
    subject = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    icon.alpha_composite(subject, ((256 - subject.width) // 2, (256 - subject.height) // 2))
    icon_path = REPO / "assets" / "ui" / "unit-icons" / "hamster-scout-rifle-skirmisher.png"
    icon.save(icon_path, optimize=True, compress_level=9)
    print(f"installed {len(sources)} sheets to {TARGET}")
    print(f"icon {icon_path}")


if __name__ == "__main__":
    main()
