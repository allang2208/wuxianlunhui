"""Build the deterministic portal depth-layer asset.

The accepted portal painting combines a tall arch with a wide marble platform.
Runtime keeps the complete painting in the rear ground-contact channel, while
this script copies only the upright portal structure into the normal structure
channel.  Retained pixels are copied verbatim; the source artwork is never
repainted or resized.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "terrain" / "portal.png"
OUTPUT = ROOT / "assets" / "terrain" / "portal_structure_occluder.png"

# Authored against the current accepted tight crop.  Scaling the mask keeps the
# extraction reproducible if a later source refresh changes the canvas by a few
# pixels without changing the composition.
REFERENCE_SIZE = (878, 775)

# One connected mask covers the arch, portal surface, pillars, their attached
# shoes and the narrow threshold.  The broad left/right/front platform remains
# exclusive to the rear ground-contact layer.
STRUCTURE_POLYGON = [
    (420, 0), (486, 23), (553, 63), (612, 126), (654, 188),
    (655, 223), (631, 242), (631, 390), (651, 406), (651, 459),
    (629, 473), (629, 513), (557, 549), (495, 527), (398, 576),
    (369, 568), (296, 610), (225, 579),
    (225, 544), (248, 529), (248, 355), (225, 338), (225, 296),
    (249, 280), (251, 226), (285, 124), (348, 50),
]


def scaled_points(size: tuple[int, int]) -> list[tuple[int, int]]:
    scale_x = size[0] / REFERENCE_SIZE[0]
    scale_y = size[1] / REFERENCE_SIZE[1]
    return [(round(x * scale_x), round(y * scale_y)) for x, y in STRUCTURE_POLYGON]


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    mask = Image.new("L", source.size, 0)
    ImageDraw.Draw(mask).polygon(scaled_points(source.size), fill=255)

    alpha = Image.new("L", source.size, 0)
    alpha = Image.composite(source.getchannel("A"), alpha, mask)
    structure = source.copy()
    structure.putalpha(alpha)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    structure.save(OUTPUT, optimize=True)


if __name__ == "__main__":
    main()
