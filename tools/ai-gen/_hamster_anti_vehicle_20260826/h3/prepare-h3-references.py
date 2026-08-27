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
        (rgb.min(axis=2) >= 244)
        & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 12)
    )
    labels, count = ndimage.label(near_white)
    sizes = ndimage.sum(near_white, labels, range(1, count + 1))
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])

    # Border-connected white is the main backdrop. Large enclosed near-white
    # components are also backdrop holes (for example between the launcher and
    # its carrying straps); tiny pale highlights/whiskers remain foreground.
    background = np.zeros(near_white.shape, dtype=bool)
    for label_index, size in enumerate(sizes, start=1):
        if label_index in border_labels or size >= 96:
            background |= labels == label_index

    foreground = ~background
    foreground_labels, foreground_count = ndimage.label(foreground)
    if foreground_count <= 0:
        raise RuntimeError(f"no subject found in {source}")
    foreground_sizes = ndimage.sum(
        foreground,
        foreground_labels,
        range(1, foreground_count + 1),
    )
    subject_label = 1 + int(np.argmax(foreground_sizes))
    subject = foreground_labels == subject_label

    alpha = Image.fromarray((subject * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(radius=0.65)
    )
    alpha_array = np.asarray(alpha).astype(np.float32) / 255.0
    clean_rgb = rgb.astype(np.float32)
    semi = (alpha_array > 0.02) & (alpha_array < 0.98)
    if semi.any():
        a = alpha_array[semi, None]
        clean_rgb[semi] = np.clip(
            (clean_rgb[semi] - (1.0 - a) * 255.0) / np.maximum(a, 1e-3),
            0,
            255,
        )
    clean_rgb[alpha_array <= 0.02] = 0
    return Image.fromarray(
        np.dstack([clean_rgb.astype(np.uint8), np.asarray(alpha)]),
        "RGBA",
    )


def fit_on_canvas(subject: Image.Image, width: int, height: int, content_ratio: float) -> Image.Image:
    bbox = subject.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("transparent subject")
    cropped = subject.crop(bbox)
    max_height = round(height * content_ratio)
    max_width = round(width * 0.72)
    scale = min(max_height / cropped.height, max_width / cropped.width)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", (width, height), "white")
    x = (width - resized.width) // 2
    y = (height - resized.height) // 2
    canvas.paste(resized.convert("RGB"), (x, y), resized.getchannel("A"))
    return canvas


def process(source: Path, alpha_out: Path, reference_out: Path, width: int, height: int) -> None:
    subject = remove_white_background(source)
    alpha_out.parent.mkdir(parents=True, exist_ok=True)
    subject.save(alpha_out)
    reference_out.parent.mkdir(parents=True, exist_ok=True)
    fit_on_canvas(subject, width, height, 0.72).save(reference_out)
    print(f"[h3-reference] {source} -> {alpha_out} -> {reference_out}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mother", type=Path, required=True)
    parser.add_argument("--rocket", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=576)
    args = parser.parse_args()

    process(
        args.mother,
        args.out_dir / "hamster-anti-vehicle-mother-v02-rgba.png",
        args.out_dir / "hamster-anti-vehicle-smg-white-1024x576.png",
        args.width,
        args.height,
    )
    process(
        args.rocket,
        args.out_dir / "hamster-anti-vehicle-rocket-v02-rgba.png",
        args.out_dir / "hamster-anti-vehicle-rocket-white-1024x576.png",
        args.width,
        args.height,
    )


if __name__ == "__main__":
    main()
