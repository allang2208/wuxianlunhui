#!/usr/bin/env python3
"""Transfer ice detail onto the canonical World-122 1x1 wall silhouette.

The current obstacle_block.png remains the geometry/brick-layout truth. The
img2img candidate contributes surface detail only; source alpha and source
luminance structure prevent brick resizing or silhouette drift.
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter


def gradient(t, low, mid, high):
    t = np.clip(t, 0.0, 1.0)[..., None]
    lower = low + (mid - low) * np.minimum(t * 2.0, 1.0)
    upper = mid + (high - mid) * np.maximum(t * 2.0 - 1.0, 0.0)
    return np.where(t <= 0.5, lower, upper)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument("candidate")
    parser.add_argument("output")
    args = parser.parse_args()

    reference = Image.open(args.reference).convert("RGBA")
    candidate = Image.open(args.candidate).convert("RGB").resize(reference.size, Image.Resampling.LANCZOS)
    ref = np.asarray(reference, dtype=np.float32)
    cand = np.asarray(candidate, dtype=np.float32)
    alpha = ref[..., 3]
    solid = alpha > 8

    ref_luma = ref[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    cand_luma = cand @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    detail = ref_luma * 0.72 + cand_luma * 0.28
    lo, hi = np.percentile(detail[solid], [3, 98])
    tone = np.clip((detail - lo) / max(1.0, hi - lo), 0.0, 1.0) ** 0.92

    # Cool three-stop palette: dark mortar, readable steel-blue ice and frosted edges.
    rgb = gradient(
        tone,
        np.array([8, 27, 40], dtype=np.float32),
        np.array([60, 122, 151], dtype=np.float32),
        np.array([202, 236, 242], dtype=np.float32),
    )
    # Candidate variation is allowed only as low-amplitude cyan value texture;
    # its geometry and chroma cannot move bricks or reintroduce green moss.
    variation = np.clip((cand_luma - 128.0) * 0.10, -12.0, 12.0)[..., None]
    rgb = np.clip(rgb + variation * np.array([0.55, 0.90, 1.05]), 0, 255)

    out = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    out[..., :3] = rgb.astype(np.uint8)
    out[..., 3] = alpha.astype(np.uint8)
    out[~solid, :3] = 0
    result = Image.fromarray(out, "RGBA").filter(ImageFilter.UnsharpMask(radius=0.9, percent=105, threshold=3))
    # Reapply exact source alpha after sharpening so the canonical silhouette is untouched.
    result.putalpha(reference.getchannel("A"))
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    result.save(args.output, optimize=True)
    print(f"saved {args.output}: {result.width}x{result.height}, alpha=reference")


if __name__ == "__main__":
    main()
