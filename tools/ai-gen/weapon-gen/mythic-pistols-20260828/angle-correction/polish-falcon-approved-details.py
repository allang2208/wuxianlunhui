#!/usr/bin/env python3
"""Clean alpha-edge color fringing and gently sharpen the approved Falcon design."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


def decontaminate_edges(source: Image.Image, radius: float) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.float32)
    alpha = rgba[:, :, 3] / 255.0
    alpha_image = Image.fromarray(np.uint8(np.clip(alpha * 255.0, 0, 255)), "L")
    blurred_alpha = np.asarray(alpha_image.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0

    extrapolated = np.zeros_like(rgba[:, :, :3])
    for channel in range(3):
        premultiplied = rgba[:, :, channel] * alpha
        premul_image = Image.fromarray(np.uint8(np.clip(premultiplied, 0, 255)), "L")
        blurred_premul = np.asarray(
            premul_image.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32
        )
        extrapolated[:, :, channel] = blurred_premul / np.maximum(blurred_alpha, 1e-4)

    edge = (rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 235)
    rgba[:, :, :3][edge] = np.clip(extrapolated[edge], 0, 255)
    return Image.fromarray(np.uint8(np.clip(rgba, 0, 255)), "RGBA")


def polish(source: Image.Image, radius: float, percent: int) -> Image.Image:
    cleaned = decontaminate_edges(source, radius=max(0.6, radius * 0.8))
    alpha = cleaned.getchannel("A")
    rgb = cleaned.convert("RGB")
    rgb = ImageEnhance.Contrast(rgb).enhance(1.025)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3))
    output = rgb.convert("RGBA")
    output.putalpha(alpha)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kind", required=True, choices=("held", "icon"))
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    if args.kind == "held":
        output = polish(source, radius=1.35, percent=62)
    else:
        output = polish(source, radius=0.72, percent=48)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(f"saved {destination} size={output.size}")


if __name__ == "__main__":
    main()
