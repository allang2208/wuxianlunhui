#!/usr/bin/env python3
"""Composite a generated building body over its World-122 footprint preview.

This creates an approval preview only. The output body remains a separate PNG;
2x2 buildings use the four BuildingRoadSystem center fillers, 4x4 compounds
use the same tile frames on a sixteen-cell isometric grid, and 1x1 structures
use one matching isometric tile for footprint review.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


CANVAS = 1024
DEFAULT_BOTTOM_Y = 880
DEFAULT_PAVING_WIDTH = 820


def parse_args():
    parser = argparse.ArgumentParser(description="Preview a World-122 building body on its isometric footprint.")
    parser.add_argument("body", type=Path, help="1024px transparent building-body PNG")
    parser.add_argument("out", type=Path, help="transparent preview PNG")
    parser.add_argument("--paving", type=Path,
                        default=Path("assets/terrain/building_road_tiles.png"))
    parser.add_argument("--bottom-y", type=int, default=DEFAULT_BOTTOM_Y)
    parser.add_argument("--paving-width", type=int, default=DEFAULT_PAVING_WIDTH)
    parser.add_argument("--footprint-cells", type=int, choices=(1, 2, 4), default=2,
                        help="logical square footprint side length; defaults to the standard 2x2 building")
    parser.add_argument("--remove-all-green", action="store_true",
                        help="remove all visible HSV-green pixels from this approval preview")
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
    logical_tile_width = args.paving_width / max(2, args.footprint_cells)
    tile_width = round(logical_tile_width * (130 / 128))
    tile_height = round(logical_tile_width * (65 / 128))
    step_x = logical_tile_width / 2
    step_y = logical_tile_width / 4
    if args.footprint_cells == 1:
        placements = [(0, CANVAS / 2, args.bottom_y - tile_height / 2)]
    else:
        cells = args.footprint_cells
        first_center_y = args.bottom_y - step_y * (cells * 2 - 1)
        placements = []
        for row in range(cells):
            for column in range(cells):
                placements.append((
                    (row * cells + column) % 4,
                    CANVAS / 2 + (column - row) * step_x,
                    first_center_y + (row + column) * step_y,
                ))
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
    if args.remove_all_green:
        rgba = np.asarray(preview).copy()
        hsv = np.asarray(preview.convert("RGB").convert("HSV"))
        hue = hsv[..., 0].astype(np.float32) * (179.0 / 255.0)
        green = ((hue >= 35.0) & (hue <= 90.0)
                 & (hsv[..., 1] >= 24) & (hsv[..., 2] >= 24)
                 & (rgba[..., 3] > 0))
        rgba[green] = (0, 0, 0, 0)
        rgba[rgba[..., 3] == 0] = (0, 0, 0, 0)
        preview = Image.fromarray(rgba, "RGBA")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    preview.save(args.out)
    print(f"preview -> {args.out}")


if __name__ == "__main__":
    main()
