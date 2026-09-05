"""Build the deterministic cheese-farm pasture/occluder layer pack.

The accepted farm painting is intentionally kept intact as the base layer.  The
two upper layers duplicate only the pixels that must be able to cover internal
cow visuals: the compact building cluster and the two front fence edges.  This
avoids inventing grass underneath the accepted art while still giving runtime a
stable base -> cows -> occluders composition.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "terrain" / "cheese_farm.png"
ASSET_DIR = ROOT / "assets" / "terrain"
PREVIEW_DIR = (
    ROOT
    / "tools"
    / "ai-gen"
    / "_settlement_building_pack_20260821"
    / "cheese_farm"
    / "layer_pack"
)

# Authored mask/activity coordinates were drawn against the first accepted
# 898x514 cutout.  Later texture refinements may change the tight crop by a
# pixel or two, so map that reference coordinate space onto the installed
# runtime canvas instead of stretching the approved art back to the old size.
REFERENCE_SIZE = (898, 514)

# Keep the upper mask close to the actual connected building silhouettes.  A
# previous broad insurance mask also copied open grass, which made the left and
# centre pasture pockets unusable for cows.
STRUCTURE_OCCLUDER_POLYGONS = [
    # Main dairy hall.
    [
        (247, 142), (420, 75), (554, 138), (540, 224), (488, 269),
        (476, 338), (422, 361), (350, 342), (327, 283), (267, 250),
    ],
    # Open-front cowshed.
    [
        (165, 197), (292, 158), (409, 222), (394, 337),
        (335, 357), (257, 343), (168, 312), (165, 246),
    ],
    # Cheese workshop, press and the two fixed troughs.
    [
        (482, 89), (541, 56), (607, 84), (640, 124), (668, 188),
        (665, 226), (610, 242), (578, 266), (526, 270), (503, 224),
        (492, 166),
    ],
]

FRONT_FENCE_POLYGONS = [
    [(0, 259), (430, 459), (438, 514), (0, 337)],
    [(370, 457), (898, 209), (898, 297), (404, 514)],
]

# Cow foot-point zones in source-image pixels.  The final animation importer
# must erode each polygon by that action's foot-relative alpha bounds.
SAFE_ACTIVITY_ZONES = {
    "right_main": [
        (686, 159), (782, 203), (817, 231), (810, 258),
        (753, 287), (690, 314), (646, 297), (628, 274),
        (644, 247), (667, 219),
    ],
    "front_pasture": [
        (326, 376), (391, 363), (456, 344), (521, 333),
        (563, 351), (548, 375), (496, 398), (425, 425),
        (361, 414), (315, 395),
    ],
}

# The only cross-zone route stays inside the open strip above the gate and
# below the workshop/troughs.  Direct front/right targeting remains forbidden.
SAFE_CORRIDORS = [
    {
        "from": "front_pasture",
        "to": "right_main",
        "points": [(535, 356), (570, 331), (607, 307), (646, 287), (685, 271)],
    },
]


def scaled_points(
    points: list[tuple[int, int]], size: tuple[int, int]
) -> list[tuple[int, int]]:
    scale_x = size[0] / REFERENCE_SIZE[0]
    scale_y = size[1] / REFERENCE_SIZE[1]
    return [(round(x * scale_x), round(y * scale_y)) for x, y in points]


def masked_layer(source: Image.Image, polygons: list[list[tuple[int, int]]]) -> Image.Image:
    mask = Image.new("L", source.size, 0)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(scaled_points(polygon, source.size), fill=255)
    alpha = Image.new("L", source.size, 0)
    alpha = Image.composite(source.getchannel("A"), alpha, mask)
    layer = source.copy()
    layer.putalpha(alpha)
    return layer


def checkerboard(size: tuple[int, int], cell: int = 20) -> Image.Image:
    canvas = Image.new("RGBA", size, (44, 44, 44, 255))
    draw = ImageDraw.Draw(canvas)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(62, 62, 62, 255))
    return canvas


def panel(image: Image.Image, label: str, overlay=None) -> Image.Image:
    label_h = 34
    result = checkerboard((image.width, image.height + label_h))
    result.alpha_composite(image, (0, label_h))
    if overlay is not None:
        overlay(result, label_h)
    draw = ImageDraw.Draw(result)
    draw.rectangle((0, 0, image.width, label_h), fill=(24, 24, 24, 255))
    draw.text((12, 9), label, font=ImageFont.load_default(), fill=(240, 240, 240, 255))
    return result


def build_preview(source: Image.Image, structure: Image.Image, foreground: Image.Image) -> Image.Image:
    def zone_overlay(canvas: Image.Image, y_offset: int) -> None:
        tint = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(tint)
        for polygon_points in SAFE_ACTIVITY_ZONES.values():
            scaled = scaled_points(polygon_points, source.size)
            polygon = [(x, y + y_offset) for x, y in scaled]
            draw.polygon(polygon, fill=(28, 210, 116, 86), outline=(80, 255, 165, 255), width=4)
            for x, y in scaled:
                draw.ellipse((x - 3, y + y_offset - 3, x + 3, y + y_offset + 3), fill=(220, 255, 235, 255))
        for corridor in SAFE_CORRIDORS:
            points = [(x, y + y_offset) for x, y in scaled_points(corridor["points"], source.size)]
            draw.line(points, fill=(70, 205, 255, 235), width=5, joint="curve")
            for x, y in points:
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(205, 244, 255, 255))
        canvas.alpha_composite(tint)

    panels = [
        panel(source, "1 BASE: accepted complete painting (below cows)"),
        panel(structure, "2 STRUCTURE OCCLUDER: buildings (above cows)"),
        panel(foreground, "3 FOREGROUND OCCLUDER: front fence + gate (above cows)"),
        panel(source, "4 SAFE COW FOOT-POINT ZONE", zone_overlay),
    ]
    gap = 12
    out = Image.new(
        "RGBA",
        (source.width * 2 + gap, (source.height + 34) * 2 + gap),
        (18, 18, 18, 255),
    )
    out.alpha_composite(panels[0], (0, 0))
    out.alpha_composite(panels[1], (source.width + gap, 0))
    out.alpha_composite(panels[2], (0, source.height + 34 + gap))
    out.alpha_composite(panels[3], (source.width + gap, source.height + 34 + gap))
    return out


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    if source.width <= 0 or source.height <= 0:
        raise ValueError(f"Invalid cheese farm size: {source.size}")

    structure = masked_layer(source, STRUCTURE_OCCLUDER_POLYGONS)
    foreground = masked_layer(source, FRONT_FENCE_POLYGONS)

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    source.save(ASSET_DIR / "cheese_farm_base.png", optimize=True)
    structure.save(ASSET_DIR / "cheese_farm_structure_occluder.png", optimize=True)
    foreground.save(ASSET_DIR / "cheese_farm_foreground_occluder.png", optimize=True)
    build_preview(source, structure, foreground).save(
        PREVIEW_DIR / "cheese_farm_layer_preview.png", optimize=True
    )


if __name__ == "__main__":
    main()
