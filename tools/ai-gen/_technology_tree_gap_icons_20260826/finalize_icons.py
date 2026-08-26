#!/usr/bin/env python3
"""Finalize the remaining World-122 technology-tree icons for runtime use."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROJECT = ROOT.parents[2]
RUNTIME = PROJECT / "assets" / "ui" / "technology-icons"

ICON_BACKGROUND_MODES = {
    "dairy_husbandry": "black",
    "cheese_standardization": "black",
    "chain_restaurant_management": "checker",
    "chain_restaurant_standardization": "black",
    "capital_markets": "black",
    "mining_standardization": "checker",
    "high_energy_experimentation": "black",
    "planar_observation_science": "black",
    "interplane_research_coordination": "black",
    "deep_drilling": "black",
    "thatch_hut_level_1": "black",
    "thatch_hut_level_2": "black",
    "thatch_hut_level_3": "black",
    "hamster_barracks_level_1": "black",
    "hamster_barracks_level_2": "black",
    "hamster_barracks_level_3": "black",
    "shooting_range_level_1": "black",
    "shooting_range_level_2": "black",
    "shooting_range_level_3": "black",
    "cavalry_school_level_1": "black",
    "cavalry_school_level_2": "black",
    "cavalry_school_level_3": "black",
    "church_level_1": "black",
    "church_level_2": "black",
    "church_level_3": "black",
}


def find_badge_bounds(image: Image.Image, background_mode: str) -> tuple[int, int, int, int]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    hi = rgb.max(axis=2).astype(np.int16)
    lo = rgb.min(axis=2).astype(np.int16)
    chroma = hi - lo
    luma = rgb.mean(axis=2)

    if background_mode == "black":
        candidate = (luma < 26) & (chroma < 20)
    elif background_mode == "checker":
        candidate = (chroma < 20) & ((luma < 82) | (luma > 166))
    else:
        raise ValueError(background_mode)

    mid_x = image.width // 2
    mid_y = image.height // 2
    row = np.where(~candidate[mid_y, :])[0]
    column = np.where(~candidate[:, mid_x])[0]
    if not len(row) or not len(column):
        raise RuntimeError("badge bounds not found")
    margin = max(2, round(min(image.size) * 0.002))
    return (
        max(0, int(row[0]) - margin),
        max(0, int(column[0]) - margin),
        min(image.width - 1, int(row[-1]) + margin),
        min(image.height - 1, int(column[-1]) + margin),
    )


def cut_hex_badge(image: Image.Image, background_mode: str) -> Image.Image:
    rgba = image.convert("RGBA")
    left, top, right, bottom = find_badge_bounds(image, background_mode)
    center_x = (left + right) // 2
    shoulder = round((bottom - top) * 0.25)
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).polygon(
        [
            (center_x, top),
            (right, top + shoulder),
            (right, bottom - shoulder),
            (center_x, bottom),
            (left, bottom - shoulder),
            (left, top + shoulder),
        ],
        fill=255,
    )
    rgba.putalpha(mask.filter(ImageFilter.GaussianBlur(0.65)))
    return rgba


def normalize(image: Image.Image, size: int = 1024, visible_size: int = 1000) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("empty alpha mask")
    crop = rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    scale = min(visible_size / crop.width, visible_size / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((size - resized.width) // 2, (size - resized.height) // 2),
    )
    return canvas


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for name, background_mode in ICON_BACKGROUND_MODES.items():
        source = Image.open(RAW / f"{name}-raw.png")
        icon = normalize(cut_hex_badge(source, background_mode))
        icon.save(RUNTIME / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
