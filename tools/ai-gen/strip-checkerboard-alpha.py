#!/usr/bin/env python3
"""Remove a baked light checkerboard and normalize an inventory icon to RGBA.

The built-in image generator may render its transparency preview into RGB.  This
tool estimates the two checker colors from the image border, converts distance
from those colors into a soft alpha mask, keeps the largest subject component,
decontaminates the anti-aliased edge, and places it on a square transparent
canvas.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def border_pixels(rgb: np.ndarray, band: int = 48) -> np.ndarray:
    return np.concatenate((
        rgb[:band].reshape(-1, 3),
        rgb[-band:].reshape(-1, 3),
        rgb[:, :band].reshape(-1, 3),
        rgb[:, -band:].reshape(-1, 3),
    ))


def checker_colors(rgb: np.ndarray) -> np.ndarray:
    ring = border_pixels(rgb)
    counts = Counter(map(tuple, ring.tolist()))
    neutral = [
        np.asarray(color, dtype=np.float32)
        for color, _ in counts.most_common(64)
        if min(color) >= 220 and max(color) - min(color) <= 8
    ]
    if len(neutral) < 2:
        raise RuntimeError("could not identify two light neutral checker colors")
    first = neutral[0]
    second = max(neutral[1:], key=lambda color: float(np.linalg.norm(color - first)))
    return np.stack((first, second))


def build_alpha(rgb: np.ndarray, backgrounds: np.ndarray,
                clear_distance: float, solid_distance: float) -> tuple[np.ndarray, np.ndarray]:
    image = rgb.astype(np.float32)
    distances = np.sqrt(((image[:, :, None, :] - backgrounds[None, None, :, :]) ** 2).sum(axis=3))
    nearest_index = distances.argmin(axis=2)
    nearest_distance = distances.min(axis=2)
    alpha = np.clip(
        (nearest_distance - clear_distance) / max(solid_distance - clear_distance, 1.0),
        0.0,
        1.0,
    )

    labels, count = ndimage.label(alpha > 0.08)
    if count:
        sizes = ndimage.sum(alpha > 0.08, labels, range(1, count + 1))
        keep = labels == (1 + int(np.argmax(sizes)))
        alpha = np.where(keep, alpha, 0.0)

    alpha = ndimage.gaussian_filter(alpha, sigma=0.45)
    alpha[alpha < 0.015] = 0.0
    alpha[alpha > 0.985] = 1.0
    return alpha, nearest_index


def decontaminate(rgb: np.ndarray, alpha: np.ndarray,
                  backgrounds: np.ndarray, nearest_index: np.ndarray) -> np.ndarray:
    image = rgb.astype(np.float32)
    background = backgrounds[nearest_index]
    a = alpha[:, :, None]
    foreground = (image - (1.0 - a) * background) / np.maximum(a, 0.08)
    foreground = np.clip(foreground, 0, 255)
    foreground[alpha == 0] = 0
    return foreground.astype(np.uint8)


def normalize(rgba: np.ndarray, size: int, margin: int) -> Image.Image:
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("cutout produced an empty alpha mask")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    subject = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")
    available = size - margin * 2
    scale = min(available / subject.width, available / subject.height)
    target = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((size - target[0]) // 2, (size - target[1]) // 2))
    return canvas


def process(src: Path, dst: Path, size: int, margin: int,
            clear_distance: float, solid_distance: float) -> None:
    rgb = np.asarray(Image.open(src).convert("RGB"))
    backgrounds = checker_colors(rgb)
    alpha, nearest_index = build_alpha(rgb, backgrounds, clear_distance, solid_distance)
    foreground = decontaminate(rgb, alpha, backgrounds, nearest_index)
    rgba = np.dstack((foreground, np.rint(alpha * 255).astype(np.uint8)))
    output = normalize(rgba, size, margin)
    dst.parent.mkdir(parents=True, exist_ok=True)
    output.save(dst)
    colors = ", ".join("#" + "".join(f"{int(c):02X}" for c in color) for color in backgrounds)
    print(f"saved {dst} checker={colors}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="input PNG or folder")
    parser.add_argument("--out", required=True, help="output PNG or folder")
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--margin", type=int, default=28)
    parser.add_argument("--clear-distance", type=float, default=10.0)
    parser.add_argument("--solid-distance", type=float, default=42.0)
    args = parser.parse_args()

    src = Path(args.input)
    dst = Path(args.out)
    if src.is_dir():
        for path in sorted(src.glob("*.png")):
            process(path, dst / path.name, args.size, args.margin,
                    args.clear_distance, args.solid_distance)
    else:
        process(src, dst, args.size, args.margin,
                args.clear_distance, args.solid_distance)


if __name__ == "__main__":
    main()
