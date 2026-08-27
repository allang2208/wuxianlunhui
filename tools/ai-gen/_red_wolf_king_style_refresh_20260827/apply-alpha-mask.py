#!/usr/bin/env python3
"""Apply the approved BiRefNet alpha mask to the RedWolfKing mother image."""

from pathlib import Path

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "red-wolf-king-mother-v01.png"
MASK = HERE / "red-wolf-king-mother-v01-alpha.png"
OUTPUT = HERE / "red-wolf-king-mother-v01-cutout-clean.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    alpha = Image.open(MASK).convert("L")
    if source.size != alpha.size:
        raise RuntimeError(f"source/mask size mismatch: {source.size} vs {alpha.size}")

    rgb = np.asarray(source, dtype=np.float32)
    a = np.asarray(alpha, dtype=np.float32) / 255.0
    clean = rgb.copy()
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        af = a[semi, None]
        clean[semi] = np.clip((clean[semi] - (1.0 - af) * 255.0) / af, 0, 255)
    clean[a <= 0.02] = 0
    alpha_np = np.where(a <= 0.02, 0, np.asarray(alpha, dtype=np.uint8))

    rgba = Image.fromarray(
        np.dstack([clean.astype(np.uint8), alpha_np]),
        "RGBA",
    )
    rgba.save(OUTPUT)
    print(f"saved {OUTPUT} size={rgba.size} bbox={rgba.getchannel('A').getbbox()}")


if __name__ == "__main__":
    main()
