#!/usr/bin/env python3
"""Derive the runtime unit icon from the approved halberdier idle sheet."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = REPO / "assets" / "companions" / "hamster_halberdier" / "idle.png"
OUTPUT = REPO / "assets" / "ui" / "unit-icons" / "hamster-halberdier.png"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    idle = Image.open(SOURCE).convert("RGBA")
    idle.crop((0, 0, 512, 512)).save(OUTPUT, optimize=True, compress_level=9)


if __name__ == "__main__":
    main()
