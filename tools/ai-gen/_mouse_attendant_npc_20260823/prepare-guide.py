#!/usr/bin/env python3
"""Build a Mouse Attendant img2img guide using the Mouse King's frame layout."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "assets/npc/mouse_attendant.png"
CUTOUT = Path(__file__).with_name("mouse-attendant-cutout.png")
OUT = Path(__file__).with_name("mouse-attendant-world-guide-green.png")

CANVAS = 1024
TARGET_HEIGHT = 780  # Mouse King frame 0: 390 / 512 of the cell height.
FOOT_Y = 908         # Mouse King frame 0: bottom y 454 / 512 of the cell height.
BG = (0, 255, 0, 255)


def main() -> None:
    if not CUTOUT.exists():
        raise SystemExit(f"missing cutout: {CUTOUT}")

    subject = Image.open(CUTOUT).convert("RGBA")
    bbox = subject.getchannel("A").getbbox()
    if not bbox:
        raise SystemExit("cutout has no visible subject")
    subject = subject.crop(bbox)

    scale = TARGET_HEIGHT / subject.height
    width = round(subject.width * scale)
    subject = subject.resize((width, TARGET_HEIGHT), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), BG)
    x = (CANVAS - width) // 2
    y = FOOT_Y - TARGET_HEIGHT
    canvas.alpha_composite(subject, (x, y))
    canvas.convert("RGB").save(OUT)
    print(f"guide={OUT} subject={width}x{TARGET_HEIGHT} at ({x},{y})")


if __name__ == "__main__":
    main()
