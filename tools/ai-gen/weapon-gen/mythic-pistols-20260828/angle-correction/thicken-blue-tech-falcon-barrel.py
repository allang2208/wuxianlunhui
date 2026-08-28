#!/usr/bin/env python3
"""Thicken Falcon Edict's barrel and add blue technology while preserving true alpha."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def thicken_segment(
    source: Image.Image,
    box: tuple[int, int, int, int],
    scale_y: float,
) -> Image.Image:
    result = source.copy()
    segment = source.crop(box)
    new_height = round(segment.height * scale_y)
    segment = segment.resize((segment.width, new_height), Image.Resampling.LANCZOS)
    center_y = (box[1] + box[3]) / 2
    paste_y = round(center_y - new_height / 2)
    result.paste((0, 0, 0, 0), box)
    result.alpha_composite(segment, (box[0], paste_y))
    return result


def add_tech_panel(
    source: Image.Image,
    concept: Image.Image,
    target_box: tuple[int, int, int, int],
    radius: int,
    opacity: int,
) -> Image.Image:
    result = source.copy()
    x0, y0, x1, y1 = target_box
    panel = concept.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS).convert("RGBA")

    mask = Image.new("L", panel.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, panel.width - 1, panel.height - 1),
        radius=radius,
        fill=opacity,
    )
    panel.putalpha(mask)
    result.alpha_composite(panel, (x0, y0))

    glow = Image.new("RGBA", source.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    rail_y = y0 + round((y1 - y0) * 0.70)
    rail_x0 = x0 + round((x1 - x0) * 0.12)
    rail_x1 = x0 + round((x1 - x0) * 0.86)
    glow_draw.line((rail_x0, rail_y, rail_x1, rail_y), fill=(0, 113, 255, 150), width=max(4, radius // 3))
    glow = glow.filter(ImageFilter.GaussianBlur(max(3, radius // 3)))
    result = Image.alpha_composite(result, glow)

    crisp = Image.new("RGBA", source.size, (0, 0, 0, 0))
    crisp_draw = ImageDraw.Draw(crisp)
    crisp_draw.line((rail_x0, rail_y, rail_x1, rail_y), fill=(37, 218, 255, 245), width=max(2, radius // 7))
    result = Image.alpha_composite(result, crisp)
    return result


def restore_connection(
    result: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
) -> Image.Image:
    """Keep the receiver-to-barrel joint exact so vertical scaling cannot leave a seam."""
    restored = result.copy()
    restored.paste((0, 0, 0, 0), box)
    restored.alpha_composite(source.crop(box), (box[0], box[1]))
    return restored


def normalize(image: Image.Image, size: int, margin: int) -> Image.Image:
    bbox = image.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("empty alpha after blue barrel refinement")
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
    parser.add_argument("--concept", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kind", required=True, choices=("held", "icon"))
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGBA")
    concept = Image.open(args.concept).convert("RGB")
    if args.kind == "held":
        output = thicken_segment(image, (1075, 590, 1907, 835), 1.24)
        output = restore_connection(output, image, (1060, 540, 1150, 900))
        output = add_tech_panel(output, concept, (1150, 635, 1840, 815), 26, 225)
        output = normalize(output, 2048, 142)
    else:
        output = thicken_segment(image, (278, 112, 485, 221), 1.20)
        output = restore_connection(output, image, (270, 95, 310, 245))
        output = add_tech_panel(output, concept, (310, 132, 468, 208), 8, 215)
        output = normalize(output, 512, 28)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
