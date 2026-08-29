#!/usr/bin/env python3
"""Prepare FLUX.2 Dev swatches as calm, periodic tower materials."""
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "textures"
DEST = SOURCE / "prepared"
DEST.mkdir(parents=True, exist_ok=True)

ADJUSTMENTS = {
    "candidate_3_concrete": (1.00, 0.88, 0.84),
    "candidate_3_metal": (1.55, 0.90, 0.84),
}


def mirrored_periodic_tile(image):
    width, height = image.size
    tiled = Image.new("RGB", (width * 2, height * 2))
    tiled.paste(image, (0, 0))
    tiled.paste(image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (width, 0))
    tiled.paste(image.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (0, height))
    tiled.paste(image.transpose(Image.Transpose.ROTATE_180), (width, height))
    return tiled.resize((1024, 1024), Image.Resampling.LANCZOS)


def main():
    for name, (brightness, contrast, crop_ratio) in ADJUSTMENTS.items():
        image = Image.open(SOURCE / f"{name}.png").convert("RGB")
        crop_w = round(image.width * crop_ratio)
        crop_h = round(image.height * crop_ratio)
        left = (image.width - crop_w) // 2
        top = (image.height - crop_h) // 2
        image = image.crop((left, top, left + crop_w, top + crop_h))
        image = ImageEnhance.Brightness(image).enhance(brightness)
        image = ImageEnhance.Contrast(image).enhance(contrast)
        image = image.filter(ImageFilter.GaussianBlur(0.18))
        mirrored_periodic_tile(image).save(DEST / f"{name}.png")


if __name__ == "__main__":
    main()
