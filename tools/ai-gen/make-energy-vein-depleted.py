#!/usr/bin/env python3
"""Derive a no-glow depleted energy-vein texture from an accepted RGBA runtime asset.

The transform is intentionally appearance-only: canvas size and alpha are copied
byte-for-byte so the live and depleted states share the same 1x1 footprint,
anchor, mirror behavior and intrusive stitching geometry.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("dst", type=Path)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()

    rgba = np.asarray(Image.open(args.src).convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].copy()
    luminance = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

    # Retain enough broad rock contrast to read at RTS scale while removing the
    # live texture's cyan saturation and emissive impression.
    neutral = luminance * 0.78
    depleted = np.stack((neutral * 0.96, neutral, neutral * 1.03), axis=2)
    depleted = depleted * 0.88 + rgb * 0.12

    cyan = ((rgb[..., 2] > rgb[..., 0] * 1.22)
            & (rgb[..., 1] > rgb[..., 0] * 1.14)
            & (rgb[..., 2] > 62.0)
            & (alpha > 0))
    seam_luma = np.clip(luminance[cyan], 20.0, 178.0)
    depleted[cyan, 0] = seam_luma * 0.40
    depleted[cyan, 1] = seam_luma * 0.47
    depleted[cyan, 2] = seam_luma * 0.52

    out = np.dstack((np.clip(depleted, 0, 255).astype(np.uint8), alpha))
    out[alpha == 0] = (0, 0, 0, 0)
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(args.dst, optimize=True)

    metadata = {
        "source": str(args.src),
        "output": str(args.dst),
        "operation": "depleted-cool-gray-no-glow-v1",
        "size": [int(out.shape[1]), int(out.shape[0])],
        "alphaPreserved": bool(np.array_equal(out[..., 3], alpha)),
        "cyanPixelsMuted": int(np.count_nonzero(cyan)),
    }
    if args.metadata:
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
