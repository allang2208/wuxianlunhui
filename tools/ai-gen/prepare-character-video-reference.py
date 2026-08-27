#!/usr/bin/env python3
"""Place an RGBA character on a uniform RGB canvas for I2V reference upload."""

import argparse
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--content-ratio", type=float, default=0.75)
    parser.add_argument("--background", default="#FFFFFF")
    args = parser.parse_args()

    source = Image.open(args.src).convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        raise SystemExit("reference contains no visible alpha content")
    character = source.crop(bbox)
    target_h = round(args.size * args.content_ratio)
    scale = target_h / character.height
    target_w = round(character.width * scale)
    if target_w > round(args.size * 0.80):
        scale = (args.size * 0.80) / character.width
        target_w = round(character.width * scale)
        target_h = round(character.height * scale)
    character = character.resize((target_w, target_h), Image.Resampling.LANCZOS)

    background = args.background.lstrip("#")
    if len(background) != 6:
        raise SystemExit("--background must be #RRGGBB")
    rgb = tuple(int(background[i:i + 2], 16) for i in (0, 2, 4))
    canvas = Image.new("RGB", (args.size, args.size), rgb)
    x = (args.size - target_w) // 2
    y = (args.size - target_h) // 2
    canvas.paste(character.convert("RGB"), (x, y), character.getchannel("A"))

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)
    print(
        f"[reference] {source.size} bbox={bbox} -> {canvas.size} "
        f"content={target_w}x{target_h} at ({x},{y}) bg=#{background.upper()} -> {output}"
    )


if __name__ == "__main__":
    main()

