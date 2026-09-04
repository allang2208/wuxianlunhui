#!/usr/bin/env python3
"""Remove enclosed green screen only around the solar-panel field."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
SOURCE = (
    ROOT
    / "tools/ai-gen/_klein_dev_replacement_20260826/batch_03"
    / "model_plus_original_36/solar_power_plant/solar_power_plant_refine_v01_body_edgeonly.png"
)
OUTPUT = SOURCE.with_name("solar_power_plant_refine_v01_clean_body.png")


def main() -> None:
    rgba = np.asarray(Image.open(SOURCE).convert("RGBA")).copy()
    hsv = np.asarray(Image.fromarray(rgba[..., :3], "RGB").convert("HSV"))
    hue = hsv[..., 0].astype(np.float32) * (179.0 / 255.0)
    green = (
        (hue >= 35.0)
        & (hue <= 78.0)
        & (hsv[..., 1] >= 24)
        & (hsv[..., 2] >= 24)
        & (rgba[..., 3] > 0)
    )
    yy, xx = np.indices(green.shape)
    panel_field = (yy >= 600) | (xx < 320) | (xx > 770)
    removed = green & panel_field
    rgba[removed] = (0, 0, 0, 0)

    Image.fromarray(rgba, "RGBA").save(OUTPUT, optimize=True)
    print(f"removed_green_pixels={int(np.count_nonzero(removed))} -> {OUTPUT}")


if __name__ == "__main__":
    main()
