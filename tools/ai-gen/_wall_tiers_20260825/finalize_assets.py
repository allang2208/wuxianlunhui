#!/usr/bin/env python3
"""Normalize the five wall tiers and their technology icons for runtime use.

The generated wall references contain a baked checkerboard/black canvas.  The
runtime variants deliberately reuse obstacle_block.png's alpha silhouette and
content bounds so every tier keeps the exact same model, camera and footprint.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROJECT = ROOT.parents[2]
BASE_WALL = PROJECT / "assets" / "terrain" / "obstacle_block.png"
STAIR_TEMPLATE_DIR = PROJECT / "tools" / "ai-gen" / "_depth_templates"
STAIR_RAW_DIR = ROOT / "stair_raw"
THUMBNAIL_SIZE = (128, 64)
THUMBNAIL_PADDING = 3
STAIR_RUNTIME_SIZE = (512, 512)


def cut_generated_canvas(image: Image.Image, mode: str) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    hi = rgb.max(axis=2).astype(np.int16)
    lo = rgb.min(axis=2).astype(np.int16)
    chroma = hi - lo
    luma = rgb.mean(axis=2)
    if mode == "checker":
        # ImageGen's baked checker is uniformly very light; the wall outline and
        # mortar are all darker, so this avoids checker-cell connectivity gaps.
        foreground = (luma < 205) | (chroma > 28)
    elif mode == "black":
        foreground = (luma > 18) | (chroma > 15)
    else:
        raise ValueError(mode)

    alpha_image = Image.fromarray(foreground.astype(np.uint8) * 255, "L")
    alpha = np.asarray(alpha_image.filter(ImageFilter.GaussianBlur(0.55)), dtype=np.uint8)
    return Image.fromarray(
        np.dstack((rgb, alpha)),
        "RGBA",
    )


def alpha_bounds(image: Image.Image, threshold: int = 8) -> tuple[int, int, int, int]:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise RuntimeError("empty alpha mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit_wall_to_base(source: Image.Image, base: Image.Image) -> Image.Image:
    src_box = alpha_bounds(source)
    base_box = alpha_bounds(base)
    crop = source.crop(src_box)
    target_w = base_box[2] - base_box[0]
    target_h = base_box[3] - base_box[1]
    resized = crop.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, (base_box[0], base_box[1]))
    rgb = np.asarray(canvas.convert("RGB"), dtype=np.uint8).copy()
    base_alpha = np.asarray(base.getchannel("A"), dtype=np.uint8)
    rgb[base_alpha == 0] = 0
    return Image.fromarray(np.dstack((rgb, base_alpha)), "RGBA")


def normalize_icon(image: Image.Image, size: int = 1024, visible_size: int = 1000) -> Image.Image:
    rgba = image.convert("RGBA")
    crop = rgba.crop(alpha_bounds(rgba))
    scale = min(visible_size / crop.width, visible_size / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def make_thumbnail(image: Image.Image) -> Image.Image:
    """Match the building-panel 128x64 contain contract with transparent padding."""
    rgba = image.convert("RGBA")
    crop = rgba.crop(alpha_bounds(rgba))
    inner_w = THUMBNAIL_SIZE[0] - THUMBNAIL_PADDING * 2
    inner_h = THUMBNAIL_SIZE[1] - THUMBNAIL_PADDING * 2
    scale = min(inner_w / crop.width, inner_h / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", THUMBNAIL_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((THUMBNAIL_SIZE[0] - resized.width) // 2,
         (THUMBNAIL_SIZE[1] - resized.height) // 2),
    )
    return canvas


def recolor_stair_bricks(template: Image.Image, target_wall: Image.Image) -> Image.Image:
    """Transfer only the tier palette; keep the editable stair brick layout intact."""
    source = np.asarray(template.convert("RGB"), dtype=np.float32)
    source_luma = source.mean(axis=2)
    low, high = np.percentile(source_luma, (4, 96))
    normalized = np.clip((source_luma - low) / max(1.0, high - low), 0.0, 1.0)

    wall_rgba = np.asarray(target_wall.convert("RGBA"), dtype=np.uint8)
    opaque = wall_rgba[..., 3] > 16
    target_color = np.median(wall_rgba[..., :3][opaque], axis=0).astype(np.float32)
    shade = 0.42 + normalized[..., None] * 0.82
    neutral_detail = (source - source_luma[..., None]) * 0.16
    colored = np.clip(target_color[None, None, :] * shade + neutral_detail, 0, 255)
    return Image.fromarray(colored.astype(np.uint8), "RGB")


def add_rune_circuitry(image: Image.Image) -> Image.Image:
    """Add deterministic cyan rune circuits without changing the brick relief."""
    base = image.convert("RGBA")
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    core = Image.new("RGBA", base.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    core_draw = ImageDraw.Draw(core)
    glyphs = (
        ((92, 116), (126, 82), (162, 122), (126, 164), (92, 116)),
        ((360, 298), (404, 254), (448, 298), (404, 342), (360, 298)),
        ((674, 132), (706, 100), (738, 132), (706, 164), (706, 202)),
        ((794, 570), (830, 534), (866, 570), (830, 606), (794, 570)),
        ((226, 706), (270, 662), (314, 706), (270, 750), (226, 706)),
        ((568, 838), (604, 802), (640, 838), (604, 874), (568, 838)),
    )
    for glyph in glyphs:
        glow_draw.line(glyph, fill=(32, 214, 255, 190), width=13, joint="curve")
        core_draw.line(glyph, fill=(98, 235, 255, 235), width=4, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(7))
    return Image.alpha_composite(Image.alpha_composite(base, glow), core)


def build_stair_materials(terrain_out: Path) -> None:
    white = Image.open(STAIR_TEMPLATE_DIR / "stair_tread_whitegray.png")
    black = Image.open(STAIR_TEMPLATE_DIR / "stair_tread_grayblack.png").convert("RGB")
    wall_sources = {
        "sand": Image.open(terrain_out / "obstacle_block_sand.png"),
        "brick": Image.open(terrain_out / "obstacle_block_brick.png"),
        "concrete": Image.open(terrain_out / "obstacle_block_concrete.png"),
    }
    materials = {
        "sand": recolor_stair_bricks(white, wall_sources["sand"]),
        "brick": recolor_stair_bricks(white, wall_sources["brick"]),
        "black_brick": black,
        "concrete": recolor_stair_bricks(white, wall_sources["concrete"]),
        "rune": add_rune_circuitry(black),
    }
    for tier, image in materials.items():
        image.save(STAIR_TEMPLATE_DIR / f"stair_tread_{tier}.png", optimize=True)


def finalize_stair_renders(terrain_out: Path, thumbnail_out: Path) -> None:
    tiers = ("sand", "brick", "black_brick", "concrete", "rune")
    base_keys = (
        "wall_stair_lower_e1_pos", "wall_stair_upper_e1_pos",
        "wall_stair_lower_e1_neg", "wall_stair_upper_e1_neg",
        "wall_stair_lower_e2_pos", "wall_stair_upper_e2_pos",
        "wall_stair_lower_e2_neg", "wall_stair_upper_e2_neg",
    )
    for tier in tiers:
        for base_key in base_keys:
            raw_path = STAIR_RAW_DIR / f"{base_key}_{tier}.png"
            if not raw_path.exists():
                continue
            source = Image.open(raw_path).convert("RGBA")
            source.resize(STAIR_RUNTIME_SIZE, Image.Resampling.LANCZOS).save(
                terrain_out / f"{base_key}_{tier}.png", optimize=True
            )
        panel_source = terrain_out / f"wall_stair_lower_e1_pos_{tier}.png"
        if panel_source.exists():
            make_thumbnail(Image.open(panel_source)).save(
                thumbnail_out / f"wall_staircase_{tier}.png", optimize=True
            )
    sand_panel = thumbnail_out / "wall_staircase_sand.png"
    if sand_panel.exists():
        Image.open(sand_panel).save(thumbnail_out / "wall_staircase.png", optimize=True)


def main() -> None:
    terrain_out = PROJECT / "assets" / "terrain"
    icon_out = PROJECT / "assets" / "ui" / "technology-icons"
    base = Image.open(BASE_WALL).convert("RGBA")

    wall_specs = {
        "obstacle_block_sand": ("wall_sand_raw.png", "checker"),
        "obstacle_block_brick": ("wall_brick_raw.png", "checker"),
        "obstacle_block_concrete": ("wall_concrete_raw.png", "checker"),
        "obstacle_block_rune": ("wall_rune_raw.png", "black"),
    }
    for name, (filename, mode) in wall_specs.items():
        source = cut_generated_canvas(Image.open(RAW / filename), mode)
        fit_wall_to_base(source, base).save(terrain_out / f"{name}.png", optimize=True)

    thumbnail_out = PROJECT / "assets" / "ui" / "building-thumbnails"
    thumbnail_specs = {
        "cover_block": "obstacle_block_sand",
        "cover_block_sand": "obstacle_block_sand",
        "cover_block_brick": "obstacle_block_brick",
        "cover_block_black_brick": "obstacle_block",
        "cover_block_concrete": "obstacle_block_concrete",
        "cover_block_rune": "obstacle_block_rune",
    }
    for name, texture_key in thumbnail_specs.items():
        source = Image.open(terrain_out / f"{texture_key}.png")
        make_thumbnail(source).save(thumbnail_out / f"{name}.png", optimize=True)

    build_stair_materials(terrain_out)
    finalize_stair_renders(terrain_out, thumbnail_out)

    icon_names = (
        "wall_brickwork",
        "wall_black_brickwork",
        "wall_concrete_fortification",
        "wall_rune_fortification",
    )
    for name in icon_names:
        source = Image.open(RAW / f"{name}_raw.png")
        normalize_icon(source).save(icon_out / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
