#!/usr/bin/env python3
"""Finalize approved hamster-ranger sheets, icon and crossbow bolt for runtime."""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RUNTIME = REPO / "assets" / "companions" / "hamster_ranger"
ICON = REPO / "assets" / "ui" / "unit-icons" / "hamster-ranger.png"
BOLT_SOURCE = ROOT / "references" / "crossbow-bolt-imagegen.png"
BOLT_CONTENT_WIDTH = 448
BOLT_MAX_HEIGHT = 112
CELL = 512


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"transparent source: {BOLT_SOURCE}")
    return rgba.crop(bbox)


def finalize_bolt() -> None:
    crop = alpha_crop(Image.open(BOLT_SOURCE))
    scale = min(BOLT_CONTENT_WIDTH / crop.width, BOLT_MAX_HEIGHT / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    resized = crop.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((CELL - size[0]) // 2, (CELL - size[1]) // 2))
    canvas.save(RUNTIME / "projectile.png", optimize=True, compress_level=9)


def finalize_icon() -> None:
    idle = Image.open(ROOT / "sheets" / "interpolated" / "idle.png").convert("RGBA")
    idle.crop((0, 0, CELL, CELL)).save(ICON, optimize=True, compress_level=9)


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ICON.parent.mkdir(parents=True, exist_ok=True)
    for action in ("idle", "running", "attacking", "dying"):
        shutil.copy2(ROOT / "sheets" / "interpolated" / f"{action}.png", RUNTIME / f"{action}.png")
    finalize_bolt()
    finalize_icon()


if __name__ == "__main__":
    main()
