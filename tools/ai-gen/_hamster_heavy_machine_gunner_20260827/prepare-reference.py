#!/usr/bin/env python3
"""Prepare the approved heavy-machine-gunner mother for 16:9 I2V."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def remove_white_background(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGB")
    rgb = np.asarray(image).astype(np.int16)
    near_white = (
        (rgb.min(axis=2) >= 242)
        & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 14)
    )
    labels, count = ndimage.label(near_white)
    border_labels = set(labels[0]) | set(labels[-1]) | set(labels[:, 0]) | set(labels[:, -1])
    background = np.isin(labels, tuple(border_labels))
    foreground = ~background
    foreground_labels, foreground_count = ndimage.label(foreground)
    if foreground_count <= 0:
        raise RuntimeError(f"no subject found in {source}")
    sizes = ndimage.sum(foreground, foreground_labels, range(1, foreground_count + 1))
    subject = foreground_labels == 1 + int(np.argmax(sizes))

    alpha = Image.fromarray((subject * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(radius=0.65)
    )
    alpha_array = np.asarray(alpha).astype(np.float32) / 255.0
    clean_rgb = rgb.astype(np.float32)
    stable = (alpha_array > 0.10) & (alpha_array < 0.98)
    if stable.any():
        a = alpha_array[stable, None]
        clean_rgb[stable] = np.clip(
            (clean_rgb[stable] - (1.0 - a) * 255.0) / np.maximum(a, 0.10),
            0,
            255,
        )
    clean_rgb[alpha_array <= 0.02] = 0
    return Image.fromarray(
        np.dstack([clean_rgb.astype(np.uint8), np.asarray(alpha)]), "RGBA"
    )


def fit_on_canvas(subject: Image.Image, width: int, height: int, content_ratio: float) -> Image.Image:
    bbox = subject.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        raise RuntimeError("transparent subject")
    cropped = subject.crop(bbox)
    max_height = round(height * content_ratio)
    max_width = round(width * 0.74)
    scale = min(max_height / cropped.height, max_width / cropped.width)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", (width, height), "white")
    x = (width - resized.width) // 2
    y = (height - resized.height) // 2
    canvas.paste(resized.convert("RGB"), (x, y), resized.getchannel("A"))
    print(f"[machine-gunner-reference] subject={cropped.size} -> {resized.size} at ({x},{y})")
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mother", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--content-ratio", type=float, default=0.68)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    subject = remove_white_background(args.mother)
    rgba_out = args.out_dir / "hamster-heavy-machine-gunner-rgba.png"
    reference_out = args.out_dir / "hamster-heavy-machine-gunner-safe-1024x576.png"
    subject.save(rgba_out, optimize=True)
    fit_on_canvas(subject, 1024, 576, args.content_ratio).save(reference_out, optimize=True)
    print(f"[machine-gunner-reference] {reference_out}")


if __name__ == "__main__":
    main()
