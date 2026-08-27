#!/usr/bin/env python3
"""Clean and align the Mouse Attendant portrait to the Mouse King portrait canvas."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[4]
SRC = Path(__file__).with_name("mouse-attendant-portrait-cutout-raw.png")
KING = ROOT / "assets/ui/npc_portrait.png"
DST = ROOT / "assets/npc/mouse_attendant.png"
PREVIEW = Path(__file__).with_name("mouse-attendant-portrait-final-neutral.png")
ALPHA_CORE = 128


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if count == 0:
        raise SystemExit("portrait cutout contains no subject")
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def clean_cutout(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    source_alpha = rgba[..., 3]
    core = largest_component(source_alpha >= ALPHA_CORE)
    edge_zone = ndimage.binary_dilation(core, iterations=1)
    alpha = np.where(core | edge_zone, source_alpha, 0).astype(np.uint8)

    reliable = core & (source_alpha >= 245)
    edge = (alpha > 0) & (alpha < 245)
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        rgba[..., :3][edge] = rgba[nearest[0][edge], nearest[1][edge], :3]

    rgba[..., 3] = alpha
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


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


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    bbox = Image.fromarray(np.where(alpha > 8, 255, 0).astype(np.uint8)).getbbox()
    if not bbox:
        raise SystemExit("image contains no visible alpha")
    return bbox


def main() -> None:
    subject = clean_cutout(Image.open(SRC))
    subject_bbox = alpha_bbox(subject)
    subject = subject.crop(subject_bbox)

    king = Image.open(KING).convert("RGBA")
    king_bbox = alpha_bbox(king)
    target_height = king_bbox[3] - king_bbox[1]
    target_width = round(subject.width * target_height / subject.height)
    subject = resize_premultiplied(subject, (target_width, target_height))

    king_center_x = (king_bbox[0] + king_bbox[2]) / 2.0
    x = round(king_center_x - target_width / 2.0)
    y = king_bbox[3] - target_height
    canvas = Image.new("RGBA", king.size, (0, 0, 0, 0))
    canvas.alpha_composite(subject, (x, y))

    pixels = np.asarray(canvas).copy()
    pixels[pixels[..., 3] == 0, :3] = 0
    final = Image.fromarray(pixels, "RGBA")
    final.save(DST)

    neutral = Image.new("RGBA", final.size, (48, 52, 60, 255))
    neutral.alpha_composite(final)
    neutral.convert("RGB").save(PREVIEW)
    print(f"portrait={DST} canvas={final.size} bbox={alpha_bbox(final)} placed=({x},{y})")


if __name__ == "__main__":
    main()
