#!/usr/bin/env python3
"""Remove only large connected chroma-matte remnants from batch-04 bodies."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent / "model_plus_original_36"
SPECS = (
    {
        "asset": "computing_center",
        "hue": (35.0, 85.0),
        "min_saturation": 90,
        "min_value": 45,
        "min_component": 1500,
    },
    {
        "asset": "portal",
        "hue": (18.0, 38.0),
        "min_saturation": 105,
        "min_value": 70,
        "min_component": 1500,
    },
)


def clean(spec: dict) -> None:
    asset = spec["asset"]
    source = ROOT / asset / f"{asset}_refine_v01_body.png"
    output = source.with_name(f"{asset}_refine_v01_clean_body.png")
    rgba = np.asarray(Image.open(source).convert("RGBA")).copy()
    hsv = np.asarray(Image.fromarray(rgba[..., :3], "RGB").convert("HSV"))
    hue = hsv[..., 0].astype(np.float32) * (180.0 / 255.0)
    chroma = (
        (hue >= spec["hue"][0])
        & (hue <= spec["hue"][1])
        & (hsv[..., 1] >= spec["min_saturation"])
        & (hsv[..., 2] >= spec["min_value"])
        & (rgba[..., 3] > 0)
    )
    labels, count = ndimage.label(chroma, structure=np.ones((3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel()) if count else np.zeros(1, dtype=np.int64)
    large_ids = np.where(sizes >= spec["min_component"])[0]
    large_ids = large_ids[large_ids != 0]
    removed = np.isin(labels, large_ids)
    rgba[removed] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(output, optimize=True)
    details = ",".join(str(int(sizes[index])) for index in large_ids) or "none"
    print(
        f"{asset}: components={count} removed={int(np.count_nonzero(removed))} "
        f"sizes={details} -> {output}"
    )


def main() -> None:
    for spec in SPECS:
        clean(spec)


if __name__ == "__main__":
    main()
