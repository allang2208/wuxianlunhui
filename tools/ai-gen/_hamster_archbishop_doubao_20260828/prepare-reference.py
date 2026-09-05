from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "_hamster_archbishop_20260828" / "candidates" / "hamster-archbishop-mother-v01-white.png"
RGBA_OUT = ROOT / "references" / "hamster-archbishop-mother-v01-rgba.png"
REFERENCE_OUT = ROOT / "references" / "hamster-archbishop-safe-white-1024x576.png"


def remove_border_white(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGB")
    rgb = np.asarray(image)
    near_white = (rgb.min(axis=2) >= 242) & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 16)
    count, labels = cv2.connectedComponents(near_white.astype(np.uint8), connectivity=8)
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    background = np.zeros(near_white.shape, dtype=bool)
    for label in border_labels:
        if label > 0:
            background |= labels == label
    foreground = (~background).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, connectivity=8)
    if count <= 1:
        raise RuntimeError("No foreground subject found")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    alpha = Image.fromarray(((labels == largest) * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(radius=0.55)
    )
    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def place_on_wide_canvas(subject: Image.Image) -> Image.Image:
    bbox = subject.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("Transparent subject")
    subject = subject.crop(bbox)
    width, height = 1024, 576
    max_height = round(height * 0.66)
    max_width = round(width * 0.56)
    scale = min(max_height / subject.height, max_width / subject.width)
    size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "white")
    x = (width - subject.width) // 2
    y = (height - subject.height) // 2
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    print(f"[archbishop-reference] content={subject.size} at ({x},{y}) on {canvas.size}")
    return canvas


def main() -> None:
    RGBA_OUT.parent.mkdir(parents=True, exist_ok=True)
    subject = remove_border_white(SOURCE)
    subject.save(RGBA_OUT)
    place_on_wide_canvas(subject).save(REFERENCE_OUT)
    print(f"[archbishop-reference] {SOURCE} -> {RGBA_OUT} -> {REFERENCE_OUT}")


if __name__ == "__main__":
    main()
