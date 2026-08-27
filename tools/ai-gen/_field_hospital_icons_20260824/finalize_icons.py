#!/usr/bin/env python3
"""Finalize the generated field-hospital icons for runtime use.

The upgrade renders use either a baked checkerboard or a solid black canvas.
Only canvas-coloured pixels connected to an image border are removed so the
dark recessed portions of the steel frames remain opaque.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
PROJECT = ROOT.parents[2]


def border_connected(candidate: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(candidate)
    if count == 0:
        return np.zeros_like(candidate)
    border_labels = np.unique(np.concatenate((
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]
    )))
    border_labels = border_labels[border_labels != 0]
    return np.isin(labels, border_labels)


def cut_canvas(image: Image.Image, mode: str) -> Image.Image:
    if mode == "rounded":
        rgba = image.convert("RGBA")
        mask = Image.new("L", rgba.size, 0)
        draw = ImageDraw.Draw(mask)
        inset = max(6, round(min(rgba.size) * 0.008))
        radius = round(min(rgba.size) * 0.072)
        draw.rounded_rectangle(
            (inset, inset, rgba.width - inset - 1, rgba.height - inset - 1),
            radius=radius,
            fill=255,
        )
        mask = mask.filter(ImageFilter.GaussianBlur(0.65))
        rgba.putalpha(mask)
        return rgba

    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    hi = rgb.max(axis=2).astype(np.int16)
    lo = rgb.min(axis=2).astype(np.int16)
    chroma = hi - lo
    luma = rgb.mean(axis=2)

    if mode == "black":
        candidate = (luma < 24) & (chroma < 18)
    elif mode == "checker":
        candidate = (chroma < 16) & ((luma < 72) | (luma > 168))
    else:
        raise ValueError(mode)

    background = border_connected(candidate)
    foreground = ~background
    # Remove isolated canvas flecks but preserve holes enclosed by the frame.
    labels, count = ndimage.label(foreground)
    if count:
        sizes = ndimage.sum(foreground, labels, range(1, count + 1))
        foreground = labels == (1 + int(np.argmax(sizes)))
    alpha = ndimage.gaussian_filter(foreground.astype(np.float32), sigma=0.65)
    alpha = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))
    return Image.fromarray(rgba, "RGBA")


def normalize(image: Image.Image, size: int, visible_size: int) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("empty alpha mask")
    crop = rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    scale = min(visible_size / crop.width, visible_size / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main() -> None:
    upgrade_specs = {
        "hospital-rounds": "checker",
        "hospital-medicine": "black",
        "hospital-triage": "black",
        "hospital-staff": "rounded",
    }
    upgrade_out = PROJECT / "assets" / "ui" / "building-upgrades"
    tech_out = PROJECT / "assets" / "ui" / "technology-icons"
    upgrade_out.mkdir(parents=True, exist_ok=True)
    tech_out.mkdir(parents=True, exist_ok=True)

    for name, mode in upgrade_specs.items():
        source = Image.open(RAW / f"{name}-raw.png")
        final = normalize(cut_canvas(source, mode), 256, 244)
        final.save(upgrade_out / f"{name}.png", optimize=True)

    for name in ("field_medicine", "medical_standardization"):
        source = Image.open(RAW / f"{name}-raw.png").convert("RGBA")
        final = normalize(source, 1024, 1000)
        final.save(tech_out / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
