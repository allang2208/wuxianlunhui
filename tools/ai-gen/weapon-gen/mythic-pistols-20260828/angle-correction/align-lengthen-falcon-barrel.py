#!/usr/bin/env python3
"""Lower and lengthen Falcon Edict's barrel assembly without changing its RGBA identity."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def adjust_barrel(
    image: Image.Image,
    box: tuple[int, int, int, int],
    shift_y: int,
) -> Image.Image:
    source = image.convert("RGBA")
    result = source.copy()
    segment = source.crop(box)
    segment = segment.resize((round(segment.width * 1.16), segment.height), Image.Resampling.LANCZOS)
    result.paste((0, 0, 0, 0), box)
    result.alpha_composite(segment, (box[0], box[1] + shift_y))
    return result


def normalize(image: Image.Image, size: int, margin: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("empty alpha after barrel alignment")
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
        output = normalize(adjust_barrel(image, (1160, 470, 1907, 930), 60), 2048, 142)
    else:
        output = normalize(adjust_barrel(image, (295, 75, 485, 285), 18), 512, 28)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
