"""Build a seamless 2:1 black-stone floor and install 18 low-luminance props."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_zombie_dungeon_terrain_20260826"
ASSETS = REPO / "assets" / "terrain"
PROP_ASSETS = ASSETS / "dungeon-props"
BRICK_WIDTH = 128
BRICK_HEIGHT = 64
BRICK_PERIODS_X = 8
BRICK_PERIODS_Y = 8
BASE_WIDTH = BRICK_WIDTH * BRICK_PERIODS_X
BASE_HEIGHT = BRICK_HEIGHT * BRICK_PERIODS_Y
STONE_REFERENCE = ASSETS / "blackbrick.png"
STONE_SAMPLE_SIZE = 256


def clean_alpha(image: Image.Image, threshold=6) -> Image.Image:
    image = image.convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 0 if value <= threshold else value)
    image.putalpha(alpha)
    return image


def _tile_hash(i: int, j: int) -> int:
    """Periodic tile identity; texture periods shift i/j by exactly eight cells."""
    pi = i % BRICK_PERIODS_X
    pj = j % BRICK_PERIODS_Y
    value = (pi * 0x45D9F3B) ^ (pj * 0x27D4EB2D) ^ 0x713122
    value ^= value >> 16
    value = (value * 0x7FEB352D) & 0xFFFFFFFF
    return value ^ (value >> 15)


def _load_stone_reference():
    """Reduce the legacy stone to road-style broad, low-frequency surface variation."""
    image = Image.open(STONE_REFERENCE).convert("RGB")
    # Grid geometry supplies the joint and bevel, so remove the source tile's
    # dark rim before extracting its material. Aggressive downsample/upscale
    # suppresses photographic grain while retaining broad worn-stone movement.
    inset = 24
    image = image.crop((inset, inset, image.width - inset, image.height - inset))
    image = ImageEnhance.Color(image).enhance(0.55)
    image = ImageEnhance.Contrast(image).enhance(0.92)
    image = ImageEnhance.Brightness(image).enhance(0.68)
    image = image.resize((48, 48), Image.Resampling.LANCZOS)
    image = image.resize((STONE_SAMPLE_SIZE, STONE_SAMPLE_SIZE), Image.Resampling.BICUBIC)
    image = image.filter(ImageFilter.GaussianBlur(1.15))
    return image.load()


def _brick_pixel(x: float, y: float, stone_pixels) -> tuple[int, int, int]:
    """Evaluate one screen-space pixel of a building-standard 2:1 square paver grid."""
    # Projected square-grid axes are (+64,+32) and (-64,+32), matching the
    # World-122 building footprint slope dy/dx=0.5 (26.565 degrees). Their
    # sums/differences create exact rectangular periods of 128x64.
    i_coord = x / BRICK_WIDTH + y / BRICK_HEIGHT
    j_coord = -x / BRICK_WIDTH + y / BRICK_HEIGHT
    i_cell = math.floor(i_coord)
    j_cell = math.floor(j_coord)
    fi = i_coord - i_cell
    fj = j_coord - j_cell
    edge_i0, edge_i1 = fi, 1.0 - fi
    edge_j0, edge_j1 = fj, 1.0 - fj
    edge = min(edge_i0, edge_i1, edge_j0, edge_j1)
    tile_seed = _tile_hash(i_cell, j_cell)

    mortar = 0.018
    bevel = 0.082
    if edge < mortar:
        grain = (((int(x) % BASE_WIDTH) * 13 + (int(y) % BASE_HEIGHT) * 7) % 3) - 1
        tone = 5 + grain
        return tone, tone + 1, tone + 2

    # The original blackbrick source now supplies only broad worn-stone tone.
    # Geometry remains analytical, so style can never bend the 2:1 grid or
    # break the texture period.
    sample_x = min(STONE_SAMPLE_SIZE - 1, max(0, int(fi * STONE_SAMPLE_SIZE)))
    sample_y = min(STONE_SAMPLE_SIZE - 1, max(0, int(fj * STONE_SAMPLE_SIZE)))
    ref_r, ref_g, ref_b = stone_pixels[sample_x, sample_y]
    tile_bias = int((tile_seed >> 9) % 9) - 5
    # Keep the same soft upper-left light as the building pipeline. The source
    # provides natural roughness; this bevel only keeps each floor cell readable.
    bevel_light = 0.0
    if edge < bevel:
        strength = min(1.0, (bevel - edge) / max(0.001, bevel - mortar))
        if min(edge_i0, edge_j0) == edge:
            bevel_light = 3.2 * strength
        else:
            bevel_light = -2.4 * strength

    return tuple(max(7, min(72, round(channel + tile_bias + bevel_light)))
                 for channel in (ref_r - 3, ref_g - 2, ref_b))


def build_black_brick_base() -> tuple[Image.Image, dict]:
    stone_pixels = _load_stone_reference()
    image = Image.new("RGB", (BASE_WIDTH, BASE_HEIGHT))
    pixels = image.load()
    for y in range(BASE_HEIGHT):
        for x in range(BASE_WIDTH):
            pixels[x, y] = _brick_pixel(x + 0.5, y + 0.5, stone_pixels)

    # Verify the analytical function itself, not just matching border colors: moving
    # by either declared texture period must produce identical RGB at every sample.
    max_delta = 0
    for y in range(0, BASE_HEIGHT, 17):
        for x in range(0, BASE_WIDTH, 19):
            sample = _brick_pixel(x + 0.5, y + 0.5, stone_pixels)
            shifted_x = _brick_pixel(x + BASE_WIDTH + 0.5, y + 0.5, stone_pixels)
            shifted_y = _brick_pixel(x + 0.5, y + BASE_HEIGHT + 0.5, stone_pixels)
            max_delta = max(max_delta,
                            *(abs(a - b) for a, b in zip(sample, shifted_x)),
                            *(abs(a - b) for a, b in zip(sample, shifted_y)))
    return image, {
        "projection": "building-standard 2:1 square grid (26.565 degrees)",
        "brickPeriod": [BRICK_WIDTH, BRICK_HEIGHT],
        "texturePeriod": [BASE_WIDTH, BASE_HEIGHT],
        "materialReference": str(STONE_REFERENCE.relative_to(REPO)).replace("\\", "/"),
        "style": "road-matched low-frequency dark stone; broad worn variation, thin joints, restrained bevels and no full-surface grain",
        "periodicSampleMaxRgbDelta": max_delta,
    }


def alpha_report(path: Path):
    image = Image.open(path).convert("RGBA")
    return {
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "size": list(image.size),
        "alphaBBox": list(image.getchannel("A").getbbox() or ()),
        "alphaExtrema": list(image.getchannel("A").getextrema()),
    }


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    reports = []

    base_path = ASSETS / "floor_dungeon_black_bricks_seamless.png"
    base_image, seam_contract = build_black_brick_base()
    base_image.save(base_path, optimize=True)
    reports.append(alpha_report(base_path))

    PROP_ASSETS.mkdir(parents=True, exist_ok=True)
    installed_props = []
    for name in manifest["props"]:
        path = PROP_ASSETS / f"{name}.png"
        clean_alpha(Image.open(SOURCE / "props" / f"{name}.png")).save(path, optimize=True)
        installed_props.append(path)
        reports.append(alpha_report(path))

    preview = Image.new("RGB", (960, 720), (5, 5, 7))
    tiled_preview = Image.new("RGB", (BASE_WIDTH * 2, BASE_HEIGHT), (5, 5, 7))
    tiled_preview.paste(base_image, (0, 0))
    tiled_preview.paste(base_image, (BASE_WIDTH, 0))
    floor_preview_h = round(960 * BASE_HEIGHT / (BASE_WIDTH * 2))
    preview.paste(tiled_preview.resize((960, floor_preview_h), Image.Resampling.LANCZOS), (0, 0))
    for index, path in enumerate(installed_props):
        image = Image.open(path).convert("RGBA")
        image.thumbnail((148, 138), Image.Resampling.LANCZOS)
        cell_x = (index % 6) * 160
        cell_y = 240 + (index // 6) * 160
        x = cell_x + (160 - image.width) // 2
        y = cell_y + (140 - image.height) // 2
        preview.paste(image, (x, y), image)
        label = path.stem.replace("dungeon_prop_", "").replace("_", " ")
        ImageDraw.Draw(preview).text((cell_x + 6, cell_y + 140), label, fill=(208, 204, 190))
    preview_path = SOURCE / "preview.png"
    preview.save(preview_path, optimize=True)

    (SOURCE / "install-report.json").write_text(
        json.dumps({"version": 2, "seamContract": seam_contract, "assets": reports},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Installed seamless black brick base, no white rubble atlas, and {len(manifest['props'])} dark props")


if __name__ == "__main__":
    main()
