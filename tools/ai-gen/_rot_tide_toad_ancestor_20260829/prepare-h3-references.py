#!/usr/bin/env python3
"""Prepare white, shadowless 1024x576 H3 first-frame references."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "mother" / "rot-tide-toad-ancestor-mother-v01-approved.png"
OUT = ROOT / "references"
CANVAS = (1024, 576)


def subject_crop(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    ys, xs = np.where(distance > 12.0)
    if not len(xs):
        raise ValueError("mother image has no detectable subject")
    pad = 18
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(image.width, int(xs.max()) + pad + 1)
    y1 = min(image.height, int(ys.max()) + pad + 1)
    return image.convert("RGB").crop((x0, y0, x1, y1))


def place(name: str, center_x: int, foot_y: int, target_height: int) -> None:
    source = subject_crop(Image.open(SOURCE))
    scale = target_height / source.height
    size = (round(source.width * scale), target_height)
    subject = source.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", CANVAS, (255, 255, 255))
    x = round(center_x - subject.width / 2)
    y = foot_y - subject.height
    canvas.paste(subject, (x, y))
    OUT.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT / name, quality=100)


def main() -> None:
    # General loop/death reference: generous margins and a stable common footline.
    place("rot-tide-toad-general-safe-white-1024x576.png", 500, 520, 355)
    # Attack reference is left-weighted to preserve clean tongue-lash travel space.
    place("rot-tide-toad-attack-safe-white-1024x576.png", 365, 520, 355)


if __name__ == "__main__":
    main()
