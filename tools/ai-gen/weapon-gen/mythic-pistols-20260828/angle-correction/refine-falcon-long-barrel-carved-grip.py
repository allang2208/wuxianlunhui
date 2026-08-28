#!/usr/bin/env python3
"""Lengthen Falcon Edict's heavy barrel and emboss carving into its walnut grip."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def lengthen_barrel(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    source = image.convert("RGBA")
    result = source.copy()
    segment = source.crop(box)
    segment = segment.resize((round(segment.width * 1.12), segment.height), Image.Resampling.LANCZOS)
    result.paste((0, 0, 0, 0), box)
    result.alpha_composite(segment, (box[0], box[1]))
    return result


def normalize(image: Image.Image, size: int, margin: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise RuntimeError("empty alpha after barrel lengthening")
    subject = image.crop(bbox)
    available = size - margin * 2
    scale = min(available / subject.width, available / subject.height)
    target = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((size - target[0]) // 2, (size - target[1]) // 2))
    return canvas


def vertical_texture(texture: Image.Image, width: int, height: int) -> np.ndarray:
    texture = texture.convert("RGB")
    crop_width = round(texture.height * width / max(height, 1))
    crop_width = min(texture.width, max(1, crop_width))
    left = (texture.width - crop_width) // 2
    texture = texture.crop((left, 0, left + crop_width, texture.height))
    return np.asarray(texture.resize((width, height), Image.Resampling.LANCZOS), dtype=np.float32)


def carve_grip(image: Image.Image, texture: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3]
    height, width = alpha.shape
    yy, xx = np.mgrid[:height, :width]
    red, green, blue = (rgb[:, :, index] for index in range(3))

    grip_region = (xx < width * 0.38) & (yy > height * 0.30)
    walnut = (
        (alpha > 8)
        & grip_region
        & (red > 55)
        & (green < red * 0.68)
        & (blue < green * 0.78)
        & (red > green * 1.35)
    )
    walnut = ndimage.binary_closing(walnut, iterations=max(1, width // 256))
    labels, count = ndimage.label(walnut)
    if not count:
        raise RuntimeError("could not locate walnut grip")
    sizes = ndimage.sum(walnut, labels, range(1, count + 1))
    walnut = labels == (1 + int(np.argmax(sizes)))

    ys, xs = np.where(walnut)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    pattern = vertical_texture(texture, x1 - x0, y1 - y0)
    local_mask = walnut[y0:y1, x0:x1]
    original = rgb[y0:y1, x0:x1]
    original_mean = float(original[local_mask].mean())
    pattern_mean = max(float(pattern[local_mask].mean()), 1.0)
    pattern = np.clip(pattern * (original_mean / pattern_mean) * 1.05, 0, 255)
    carved = original * 0.32 + pattern * 0.68
    rgb[y0:y1, x0:x1] = np.where(local_mask[:, :, None], carved, rgb[y0:y1, x0:x1])
    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--texture", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kind", required=True, choices=("held", "icon"))
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGBA")
    texture = Image.open(args.texture).convert("RGB")
    if args.kind == "held":
        image = normalize(lengthen_barrel(image, (1100, 440, 1907, 930)), 2048, 142)
    else:
        image = normalize(lengthen_barrel(image, (300, 90, 485, 280)), 512, 28)
    output = carve_grip(image, texture)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
