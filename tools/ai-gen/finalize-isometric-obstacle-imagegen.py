#!/usr/bin/env python3
"""Convert ImageGen obstacle candidates into tight RGBA cutouts with clean edge RGB."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


def clean_edge_rgb(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    reliable = alpha >= 224
    if not np.any(reliable):
        return rgb
    nearest = ndimage.distance_transform_edt(~reliable, return_distances=False, return_indices=True)
    cleaned = rgb.copy()
    edge = (alpha > 2) & (alpha < 224)
    cleaned[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    cleaned[alpha <= 2] = 0
    return cleaned


def despill_green_edge(rgb: np.ndarray, alpha: np.ndarray, edge_width: int = 8) -> np.ndarray:
    """Neutralize chroma-green contamination near the foreground silhouette."""
    foreground = alpha > 8
    if not np.any(foreground):
        return rgb
    edge = foreground & (ndimage.distance_transform_edt(foreground) <= max(1, edge_width))
    out = rgb.copy()
    red = out[..., 0].astype(np.int16)
    green = out[..., 1].astype(np.int16)
    blue = out[..., 2].astype(np.int16)
    neutral = np.maximum(red, blue)
    spill = edge & (green > neutral + 8)
    out[..., 1][spill] = np.clip(neutral[spill], 0, 255).astype(np.uint8)
    return out


def finalize(model, source: Path, output: Path, margin: int, despill_green: bool) -> None:
    rgb = np.asarray(Image.open(source).convert("RGB"), dtype=np.uint8)
    alpha = np.squeeze(np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB"))))
    if alpha.dtype != np.uint8:
        if float(np.max(alpha)) <= 1.0:
            alpha = alpha * 255.0
        alpha = np.clip(alpha, 0, 255).astype(np.uint8)

    visible = np.argwhere(alpha > 8)
    if visible.size == 0:
        raise RuntimeError(f"no foreground detected: {source}")
    y0, x0 = visible.min(axis=0)
    y1, x1 = visible.max(axis=0) + 1
    y0 = max(0, int(y0) - margin)
    x0 = max(0, int(x0) - margin)
    y1 = min(alpha.shape[0], int(y1) + margin)
    x1 = min(alpha.shape[1], int(x1) + margin)

    cleaned_rgb = clean_edge_rgb(rgb, alpha)
    if despill_green:
        cleaned_rgb = despill_green_edge(cleaned_rgb, alpha)
    rgba = np.dstack((cleaned_rgb, alpha))[y0:y1, x0:x1]
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(output)
    print(f"finalized {source.name} -> {output} size={rgba.shape[1]}x{rgba.shape[0]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--margin", type=int, default=6)
    parser.add_argument("--despill-green", action="store_true")
    args = parser.parse_args()

    source_dir = Path(args.input_dir)
    files = sorted(source_dir.glob("*_raw.png"))
    if not files:
        raise FileNotFoundError(f"no *_raw.png files in {source_dir}")
    model = get_model()
    for source in files:
        output = Path(args.output_dir) / source.name.replace("_raw.png", "_cutout.png")
        finalize(model, source, output, max(0, args.margin), args.despill_green)


if __name__ == "__main__":
    main()
