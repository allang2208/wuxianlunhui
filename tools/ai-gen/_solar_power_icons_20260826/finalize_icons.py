#!/usr/bin/env python3
"""Normalize accepted Solar Power Plant badges to World-122 runtime sizes."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROJECT = ROOT.parents[2]


def normalize(source: Path, size: int, visible_size: int) -> Image.Image:
    rgba = Image.open(source).convert("RGBA")
    pixels = np.asarray(rgba, dtype=np.uint8).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    rgba = Image.fromarray(pixels, "RGBA")
    alpha = pixels[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError(f"empty alpha mask: {source}")
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
    upgrades = (
        "solar-tracking-cycle",
        "solar-array-output",
        "solar-storage-efficiency",
        "solar-maintenance-staff",
    )
    technologies = (
        "solar_power",
        "solar_power_standardization",
    )
    upgrade_out = PROJECT / "assets" / "ui" / "building-upgrades"
    technology_out = PROJECT / "assets" / "ui" / "technology-icons"
    upgrade_out.mkdir(parents=True, exist_ok=True)
    technology_out.mkdir(parents=True, exist_ok=True)

    for name in upgrades:
        normalize(RAW / f"{name}-raw.png", 256, 244).save(
            upgrade_out / f"{name}.png", optimize=True
        )
    for name in technologies:
        normalize(RAW / f"{name}-raw.png", 1024, 1000).save(
            technology_out / f"{name}.png", optimize=True
        )


if __name__ == "__main__":
    main()
