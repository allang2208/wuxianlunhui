#!/usr/bin/env python3
"""Composite a generated building body over the immutable World-122 2x2 foundation.

This creates an approval preview only.  The output body remains a separate PNG so
the runtime-owned foundation sprite is never baked into the building texture.
"""

import argparse
from pathlib import Path

from PIL import Image


CANVAS = 1024
DEFAULT_BOTTOM_Y = 880
DEFAULT_FOUNDATION_WIDTH = 820


def parse_args():
    parser = argparse.ArgumentParser(description="Preview a World-122 building body on the fixed 2x2 foundation.")
    parser.add_argument("body", type=Path, help="1024px transparent building-body PNG")
    parser.add_argument("out", type=Path, help="transparent preview PNG")
    parser.add_argument("--foundation", type=Path,
                        default=Path("assets/terrain/building_foundation_2x2.png"))
    parser.add_argument("--bottom-y", type=int, default=DEFAULT_BOTTOM_Y)
    parser.add_argument("--foundation-width", type=int, default=DEFAULT_FOUNDATION_WIDTH)
    return parser.parse_args()


def main():
    args = parse_args()
    body = Image.open(args.body).convert("RGBA")
    if body.size != (CANVAS, CANVAS):
        body.thumbnail((CANVAS, CANVAS), Image.Resampling.LANCZOS)
        placed_body = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        placed_body.alpha_composite(body, ((CANVAS - body.width) // 2, CANVAS - body.height))
        body = placed_body

    foundation = Image.open(args.foundation).convert("RGBA")
    foundation_h = round(args.foundation_width * foundation.height / foundation.width)
    foundation = foundation.resize((args.foundation_width, foundation_h), Image.Resampling.LANCZOS)
    preview = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    preview.alpha_composite(foundation, ((CANVAS - foundation.width) // 2, args.bottom_y - foundation.height))
    preview.alpha_composite(body)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    preview.save(args.out)
    print(f"preview -> {args.out}")


if __name__ == "__main__":
    main()
