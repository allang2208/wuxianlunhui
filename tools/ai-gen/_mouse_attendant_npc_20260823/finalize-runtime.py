#!/usr/bin/env python3
"""Normalize the accepted Mouse Attendant art to the Mouse King world-frame contract."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[3]
SRC = Path(__file__).with_name("mouse-attendant-s48-final.png")
DST = ROOT / "assets/npc/mouse_attendant/idle.png"

CELL = 512
TARGET_HEIGHT = 390
FOOT_END_Y = 454
CENTER_X = 256
MATTE_RGB = np.array((42.0, 240.0, 0.0), dtype=np.float32)  # detected #2AF000


def remove_green_matte(image: Image.Image) -> Image.Image:
    """Undo straight-alpha mixing against the generated green background."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32).copy()
    alpha = rgba[..., 3:4] / 255.0
    semi = (alpha[..., 0] > 0.03) & (alpha[..., 0] < 0.98)
    rgba[..., :3][semi] = np.clip(
        (rgba[..., :3][semi] - (1.0 - alpha[semi]) * MATTE_RGB) / alpha[semi],
        0,
        255,
    )

    red, green, blue = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    opaque_spill = (
        (rgba[..., 3] >= 245)
        & (green > red + 35)
        & (green > blue + 35)
        & (green > 80)
    )
    rgba[opaque_spill] = 0

    # Low-alpha edge colors become unstable after matte reversal. Borrow the nearest
    # reliable opaque subject color while retaining the original antialiasing alpha.
    reliable = rgba[..., 3] >= 245
    edge = (rgba[..., 3] > 8) & (rgba[..., 3] < 245)
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        rgba[..., :3][edge] = rgba[nearest[0][edge], nearest[1][edge], :3]
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def resize_premultiplied(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = rgba[..., 3:4] / 255.0
    premultiplied = np.concatenate((rgba[..., :3] * alpha, rgba[..., 3:4]), axis=2)
    resized = np.asarray(
        Image.fromarray(np.clip(premultiplied, 0, 255).astype(np.uint8), "RGBA").resize(
            size, Image.Resampling.LANCZOS
        ),
        dtype=np.float32,
    )
    out_alpha = resized[..., 3:4]
    out_rgb = np.where(out_alpha > 0, resized[..., :3] * 255.0 / np.maximum(out_alpha, 1.0), 0)
    return Image.fromarray(
        np.concatenate((np.clip(out_rgb, 0, 255), out_alpha), axis=2).astype(np.uint8), "RGBA"
    )


def main() -> None:
    image = remove_green_matte(Image.open(SRC))
    bbox = image.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        raise SystemExit("accepted image has no alpha subject")

    subject = image.crop(bbox)
    target_width = max(1, round(subject.width * TARGET_HEIGHT / subject.height))
    subject = resize_premultiplied(subject, (target_width, TARGET_HEIGHT))

    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = CENTER_X - target_width // 2
    y = FOOT_END_Y - TARGET_HEIGHT
    canvas.alpha_composite(subject, (x, y))

    pixels = np.asarray(canvas).copy()
    pixels[pixels[..., 3] == 0, :3] = 0
    DST.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, "RGBA").save(DST)
    print(f"runtime={DST} subject={target_width}x{TARGET_HEIGHT} at ({x},{y})")


if __name__ == "__main__":
    main()
