#!/usr/bin/env python3
"""Replace Falcon Edict's under-barrel walnut insert with integrated blue gunmetal."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


def replace_underbarrel(
    source: Image.Image,
    texture: Image.Image,
    box: tuple[int, int, int, int],
    polygon: list[tuple[int, int]],
    radius: int,
) -> Image.Image:
    result = source.copy()
    x0, y0, x1, y1 = box
    size = (x1 - x0, y1 - y0)

    source_alpha = source.getchannel("A").crop(box)
    region_mask = Image.new("L", size, 0)
    ImageDraw.Draw(region_mask).polygon(polygon, fill=255)
    region_mask = ImageChops.multiply(region_mask, source_alpha)

    panel = texture.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    panel = ImageEnhance.Brightness(panel).enhance(0.76).convert("RGBA")
    panel.putalpha(region_mask)
    result.alpha_composite(panel, (x0, y0))

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    rail_y = round(size[1] * 0.58)
    rail_x0 = round(size[0] * 0.12)
    rail_x1 = round(size[0] * 0.79)
    draw.line(
        (rail_x0, rail_y, rail_x1, rail_y),
        fill=(0, 107, 255, 135),
        width=max(3, radius),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(max(2, radius)))
    glow.putalpha(ImageChops.multiply(glow.getchannel("A"), region_mask))
    result.alpha_composite(glow, (x0, y0))

    detail = Image.new("RGBA", size, (0, 0, 0, 0))
    detail_draw = ImageDraw.Draw(detail)
    detail_draw.line(
        (rail_x0, rail_y, rail_x1, rail_y),
        fill=(36, 205, 255, 220),
        width=max(2, radius // 3),
    )
    detail_draw.line(
        (round(size[0] * 0.04), round(size[1] * 0.12), round(size[0] * 0.88), round(size[1] * 0.12)),
        fill=(24, 96, 184, 225),
        width=max(2, radius // 2),
    )
    detail.putalpha(ImageChops.multiply(detail.getchannel("A"), region_mask))
    result.alpha_composite(detail, (x0, y0))
    return result


def normalize(image: Image.Image, size: int, margin: int) -> Image.Image:
    bbox = image.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("empty alpha after under-barrel replacement")
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
    parser.add_argument("--texture", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kind", required=True, choices=("held", "icon"))
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    texture = Image.open(args.texture).convert("RGB")
    if args.kind == "held":
        box = (1095, 805, 1710, 950)
        polygon = [(0, 0), (615, 0), (615, 78), (565, 112), (485, 145), (0, 145)]
        output = replace_underbarrel(source, texture, box, polygon, 10)
        output = normalize(output, 2048, 142)
    else:
        box = (282, 198, 450, 252)
        polygon = [(0, 0), (168, 0), (168, 30), (150, 45), (125, 54), (0, 54)]
        output = replace_underbarrel(source, texture, box, polygon, 4)
        output = normalize(output, 512, 28)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
