#!/usr/bin/env python3
"""Cut a noisy green/magenta ImageGen background and normalize a firearm icon."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def chroma_alpha(rgb: np.ndarray, mode: str) -> np.ndarray:
    image = rgb.astype(np.float32)
    red, green, blue = (image[:, :, index] for index in range(3))
    if mode == "green":
        score = green - np.maximum(red, blue)
    else:
        score = np.minimum(red, blue) - green

    # ImageGen's nominally flat chroma background has broad local RGB noise.
    # Hue dominance remains stable, while all weapon materials stay below it.
    alpha = np.clip((115.0 - score) / 75.0, 0.0, 1.0)
    labels, count = ndimage.label(alpha > 0.08)
    if count:
        sizes = ndimage.sum(alpha > 0.08, labels, range(1, count + 1))
        keep = labels == (1 + int(np.argmax(sizes)))
        alpha = np.where(keep, alpha, 0.0)

    alpha = ndimage.gaussian_filter(alpha, sigma=0.45)
    alpha[alpha < 0.015] = 0.0
    alpha[alpha > 0.985] = 1.0
    return alpha


def decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    border = np.concatenate((
        rgb[:32].reshape(-1, 3),
        rgb[-32:].reshape(-1, 3),
        rgb[:, :32].reshape(-1, 3),
        rgb[:, -32:].reshape(-1, 3),
    )).astype(np.float32)
    background = np.median(border, axis=0)
    image = rgb.astype(np.float32)
    a = alpha[:, :, None]
    foreground = (image - (1.0 - a) * background) / np.maximum(a, 0.08)
    foreground = np.clip(foreground, 0, 255)
    foreground[alpha == 0] = 0
    return foreground.astype(np.uint8)


def normalize(rgba: np.ndarray, size: int, margin: int) -> Image.Image:
    ys, xs = np.where(rgba[:, :, 3] > 8)
    if not len(xs):
        raise RuntimeError("empty foreground")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    subject = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")
    available = size - margin * 2
    scale = min(available / subject.width, available / subject.height)
    target = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((size - target[0]) // 2, (size - target[1]) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", required=True, choices=("green", "magenta"))
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--margin", type=int, default=28)
    args = parser.parse_args()

    rgb = np.asarray(Image.open(args.input).convert("RGB"))
    alpha = chroma_alpha(rgb, args.mode)
    rgba = np.dstack((decontaminate(rgb, alpha), np.rint(alpha * 255).astype(np.uint8)))
    output = normalize(rgba, args.size, args.margin)
    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
