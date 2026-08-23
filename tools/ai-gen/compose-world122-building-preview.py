#!/usr/bin/env python3
"""Composite a generated building body over the current World-122 2x2 road fill.

This creates an approval preview only. The output body remains a separate PNG;
the four road tiles mirror BuildingRoadSystem's visual-only center fillers.
"""

import argparse
from pathlib import Path

from PIL import Image


CANVAS = 1024
DEFAULT_BOTTOM_Y = 880
DEFAULT_PAVING_WIDTH = 820


def parse_args():
    parser = argparse.ArgumentParser(description="Preview a World-122 building body on the 2x2 road fill.")
    parser.add_argument("body", type=Path, help="1024px transparent building-body PNG")
    parser.add_argument("out", type=Path, help="transparent preview PNG")
    parser.add_argument("--paving", type=Path,
                        default=Path("assets/terrain/building_road_tiles.png"))
    parser.add_argument("--bottom-y", type=int, default=DEFAULT_BOTTOM_Y)
    parser.add_argument("--paving-width", type=int, default=DEFAULT_PAVING_WIDTH)
    return parser.parse_args()


def main():
    args = parse_args()
    body = Image.open(args.body).convert("RGBA")
    if body.size != (CANVAS, CANVAS):
        body.thumbnail((CANVAS, CANVAS), Image.Resampling.LANCZOS)
        placed_body = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        placed_body.alpha_composite(body, ((CANVAS - body.width) // 2, CANVAS - body.height))
        body = placed_body

    preview = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sheet = Image.open(args.paving).convert("RGBA")
    frame_width = sheet.width // 4
    frame_height = sheet.height
    logical_tile_width = args.paving_width / 2
    tile_width = round(logical_tile_width * (130 / 128))
    tile_height = round(logical_tile_width * (65 / 128))
    step_x = logical_tile_width / 2
    step_y = logical_tile_width / 4
    first_center_y = args.bottom_y - step_y * 3
    placements = [
        (0, CANVAS / 2, first_center_y),
        (1, CANVAS / 2 + step_x, first_center_y + step_y),
        (2, CANVAS / 2 - step_x, first_center_y + step_y),
        (3, CANVAS / 2, first_center_y + step_y * 2),
    ]
    for frame_index, center_x, center_y in placements:
        frame = sheet.crop((
            frame_index * frame_width, 0,
            (frame_index + 1) * frame_width, frame_height,
        )).resize((tile_width, tile_height), Image.Resampling.LANCZOS)
        preview.alpha_composite(frame, (
            round(center_x - tile_width / 2),
            round(center_y - tile_height / 2),
        ))
    preview.alpha_composite(body)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    preview.save(args.out)
    print(f"preview -> {args.out}")


if __name__ == "__main__":
    main()
