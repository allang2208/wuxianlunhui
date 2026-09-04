#!/usr/bin/env python3
"""Remove the bright yellow matte fringe from the miner-camp candidate."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[4]
SOURCE = (
    ROOT
    / "tools/ai-gen/_klein_dev_replacement_20260826/batch_03"
    / "model_plus_original_36/mine/mine_refine_v01_body.png"
)
OUTPUT = SOURCE.with_name("mine_refine_v01_clean_body.png")
RAW = SOURCE.with_name("mine_refine_v01_raw.png")


def main() -> None:
    rgba = np.asarray(Image.open(SOURCE).convert("RGBA")).copy()
    raw = np.asarray(Image.open(RAW).convert("RGB"))
    corners = np.vstack(
        (
            raw[:12, :12].reshape(-1, 3),
            raw[:12, -12:].reshape(-1, 3),
            raw[-12:, :12].reshape(-1, 3),
            raw[-12:, -12:].reshape(-1, 3),
        )
    )
    matte = np.median(corners, axis=0)
    edge_band = ndimage.binary_dilation(rgba[..., 3] == 0, iterations=4)
    matte_distance = np.linalg.norm(rgba[..., :3].astype(np.float32) - matte, axis=2)
    matte_yellow = edge_band & (matte_distance <= 190.0) & (rgba[..., 3] > 0)
    rgba[matte_yellow] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(OUTPUT, optimize=True)
    print(f"removed_yellow_halo_pixels={int(np.count_nonzero(matte_yellow))} -> {OUTPUT}")


if __name__ == "__main__":
    main()
