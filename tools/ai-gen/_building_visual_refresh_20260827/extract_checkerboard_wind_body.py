#!/usr/bin/env python3
"""Convert the accepted wind-body checkerboard render into a real RGBA cutout."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "wind_power_plant_body_candidate_v01.png"
OUTPUT = HERE / "wind_power_plant_body_accepted_rgba_v02.png"


def main() -> None:
    rgb = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.uint8)
    values = rgb.astype(np.int16)
    channel_spread = values.max(axis=2) - values.min(axis=2)

    # The generated backdrop contains only two connected neutral tones around
    # RGB 240 and 254.  Require both high luminance and near-neutral chroma so
    # the darker stone, steel and brass subject cannot enter the matte mask.
    matte_like = (values.min(axis=2) >= 229) & (channel_spread <= 12)
    labels, count = ndimage.label(
        matte_like, structure=np.ones((3, 3), dtype=np.uint8)
    )
    sizes = np.bincount(labels.ravel())
    background_labels = np.where(
        (sizes >= 24) & (np.arange(len(sizes)) > 0)
    )[0]
    background = np.isin(labels, background_labels)

    # Recover antialiased silhouette coverage from the nearest confirmed local
    # checker tone without recoloring opaque subject pixels.
    _, nearest = ndimage.distance_transform_edt(
        ~background, return_indices=True
    )
    nearest_matte = rgb[nearest[0], nearest[1]].astype(np.float32)
    color_distance = np.linalg.norm(
        rgb.astype(np.float32) - nearest_matte, axis=2
    )
    distance_to_background = ndimage.distance_transform_edt(~background)
    alpha = np.ones(background.shape, dtype=np.float32)
    alpha[background] = 0.0
    edge_band = (~background) & (distance_to_background <= 3.0)
    alpha[edge_band] = np.clip(
        (color_distance[edge_band] - 1.5) / 42.0, 0.0, 1.0
    )
    alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    alpha_u8[alpha_u8 < 6] = 0

    rgba = np.dstack((rgb.copy(), alpha_u8))
    rgba[alpha_u8 == 0, :3] = 0
    Image.fromarray(rgba, "RGBA").save(OUTPUT, optimize=True)
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
