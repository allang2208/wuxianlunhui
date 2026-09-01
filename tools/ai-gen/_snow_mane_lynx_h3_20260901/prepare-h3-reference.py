#!/usr/bin/env python3
"""Fit approved lynx action keyframes onto exact 1024x576 white H3 canvases."""

import argparse

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
TARGET = (1024, 576)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT / "references" / "snow-mane-lynx-running-keyframe-v01-source.png",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "references" / "snow-mane-lynx-running-keyframe-v01-1024x576.png",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Image.open(args.source).convert("RGB")
    scale = min(TARGET[0] / source.width, TARGET[1] / source.height)
    fitted_size = (round(source.width * scale), round(source.height * scale))
    fitted = source.resize(fitted_size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", TARGET, "white")
    offset = ((TARGET[0] - fitted.width) // 2, (TARGET[1] - fitted.height) // 2)
    canvas.paste(fitted, offset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)
    print(f"[lynx-h3-reference] {source.size} -> {fitted.size} at {offset} -> {args.output}")


if __name__ == "__main__":
    main()
