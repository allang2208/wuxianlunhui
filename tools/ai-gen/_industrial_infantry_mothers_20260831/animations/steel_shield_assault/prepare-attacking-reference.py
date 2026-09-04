#!/usr/bin/env python3
"""Prepare the approved-direction steel-shield attack keyframe for Doubao."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "keyframes" / "attacking-keyframe-v02-right.png"
OUTPUT = ROOT / "references" / "steel-shield-assault-attacking-keyframe-v02-video-safe-16x9.png"
SIZE = (1024, 576)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    scale = min(SIZE[0] / source.width, SIZE[1] / source.height)
    resized = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", SIZE, "white")
    canvas.paste(resized, ((SIZE[0] - resized.width) // 2, (SIZE[1] - resized.height) // 2))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True)


if __name__ == "__main__":
    main()
