#!/usr/bin/env python3
"""Prepare weather-tower init/depth inputs without the animated vane arms."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
BATCH = ROOT / "tools/ai-gen/_klein_dev_replacement_20260826/batch_04"
SOURCE_ROOT = ROOT / "tools/ai-gen/_settlement_building_pack_20260821"
INIT_SOURCE = (
    SOURCE_ROOT
    / "weather_forecast_tower_runtime_style_refine_48_raw"
    / "weather_forecast_tower_refine48_v01_raw.png"
)
CONTROL_SOURCE = SOURCE_ROOT / "weather_forecast_tower/weather_forecast_tower_body_depth.png"
POST_SOURCE = SOURCE_ROOT / "weather_forecast_tower/weather_forecast_tower_depth.png"
OUT = BATCH / "weather_static_body_inputs"

# Source-space rotating-vane envelope. Preserve the vertical mast and compact hub.
CLEAR_RECT = (395, 72, 580, 205)
MAST_RECT = (481, 70, 493, 272)
HUB_CENTER = (487, 142)
HUB_RADIUS = (13, 11)


def clear_rotating_parts(image: Image.Image, fill: tuple[int, int, int, int]) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    height, width = rgba.shape[:2]
    yy, xx = np.ogrid[:height, :width]
    x0, y0, x1, y1 = CLEAR_RECT
    region = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    keep_mast = (
        (xx >= MAST_RECT[0])
        & (xx < MAST_RECT[2])
        & (yy >= MAST_RECT[1])
        & (yy < MAST_RECT[3])
    )
    rx, ry = HUB_RADIUS
    keep_hub = (
        ((xx - HUB_CENTER[0]) / rx) ** 2
        + ((yy - HUB_CENTER[1]) / ry) ** 2
        <= 1.0
    )
    rgba[region & ~keep_mast & ~keep_hub] = fill
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    init = Image.open(INIT_SOURCE).convert("RGBA")
    corners = np.vstack(
        (
            np.asarray(init)[:16, :16].reshape(-1, 4),
            np.asarray(init)[:16, -16:].reshape(-1, 4),
            np.asarray(init)[-16:, :16].reshape(-1, 4),
            np.asarray(init)[-16:, -16:].reshape(-1, 4),
        )
    )
    matte = tuple(int(value) for value in np.median(corners, axis=0))
    clear_rotating_parts(init, matte).save(OUT / "weather_static_body_init.png", optimize=True)
    clear_rotating_parts(Image.open(CONTROL_SOURCE), (0, 0, 0, 255)).save(
        OUT / "weather_static_body_control_depth.png",
        optimize=True,
    )
    clear_rotating_parts(Image.open(POST_SOURCE), (0, 0, 0, 255)).save(
        OUT / "weather_static_body_post_depth.png",
        optimize=True,
    )
    print(f"matte={matte} -> {OUT}")


if __name__ == "__main__":
    main()
