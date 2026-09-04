#!/usr/bin/env python3
"""Compose the actual direction reference and exact H3 endpoint keyframes."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "previews" / "dying-v04-direction-review.png"
REFERENCE = ROOT / "references" / "special-forces-recon_walk-direction-contact.png"
START = ROOT / "keyframes" / "running-keyframe-v01.png"
END = ROOT / "keyframes" / "dying-end-keyframe-v03-right-side.png"


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    copy = image.convert("RGB")
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "#20242a")
    canvas.paste(copy, ((width - copy.width) // 2, (height - copy.height) // 2))
    return canvas


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (1600, 1060), "#171a1f")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    canvas.paste(fit(Image.open(REFERENCE), 1520, 300), (40, 50))
    canvas.paste(fit(Image.open(START), 740, 620), (40, 400))
    canvas.paste(fit(Image.open(END), 740, 620), (820, 400))
    draw.text((40, 22), "ACTUAL APPROVED LINE REFERENCE: frames 0,8,17,25,33 - right-facing elevated three-quarter", fill="white", font=font)
    draw.text((40, 370), "EXACT FIRST FRAME: approved right-facing stride; no generated frontal reset", fill="white", font=font)
    draw.text((820, 370), "EXACT LAST FRAME: side-lying, body yaw and complete shotgun remain -> screen right", fill="white", font=font)
    canvas.save(OUT, optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
