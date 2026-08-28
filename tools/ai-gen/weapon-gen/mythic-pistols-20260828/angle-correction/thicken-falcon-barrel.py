#!/usr/bin/env python3
"""Thicken Falcon Edict's barrel while preserving the existing RGBA alpha."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def reshape_barrel(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    source = image.convert("RGBA")
    result = source.copy()
    segment = source.crop(box)
    width = round(segment.width * 0.78)
    height = round(segment.height * 1.45)
    segment = segment.resize((width, height), Image.Resampling.LANCZOS)

    result.paste((0, 0, 0, 0), box)
    x = box[0]
    y = round((box[1] + box[3] - height) / 2)
    result.alpha_composite(segment, (x, y))
    return result


def normalize(image: Image.Image, size: int, margin: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("empty alpha after barrel reshape")
    subject = image.crop(bbox)
    available = size - margin * 2
    scale = min(available / subject.width, available / subject.height)
    target = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((size - target[0]) // 2, (size - target[1]) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kind", required=True, choices=("held", "icon"))
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGBA")
    if args.kind == "held":
        output = normalize(reshape_barrel(image, (1100, 545, 1905, 815)), 2048, 142)
    else:
        output = normalize(reshape_barrel(image, (280, 120, 484, 240)), 512, 28)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
