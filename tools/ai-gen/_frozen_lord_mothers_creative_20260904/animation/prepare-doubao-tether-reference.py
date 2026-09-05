#!/usr/bin/env python3
"""Fit and compare the approved Aurora Fate Weaver tether Doubao reference."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
KEYFRAME = ROOT / "action-keyframes" / "02-aurora-fate-weaver-tether-prepare-v02.png"
IDENTITY = ROOT / "reference-source" / "02-aurora-fate-weaver-action-ready-v02.png"
OUTPUT = ROOT / "action-references" / "02-aurora-fate-weaver-tether-prepare-v02-1024x576.png"
CONTACT = ROOT / "action-references" / "02-aurora-fate-weaver-tether-direction-gate-v02.png"
CANVAS_SIZE = (1024, 576)


def subject_crop(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    ys, xs = np.where(distance > 14.0)
    if not len(xs):
        raise RuntimeError(f"no subject found in {path}")
    pad = 18
    return image.crop((
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(image.width, int(xs.max()) + pad + 1),
        min(image.height, int(ys.max()) + pad + 1),
    ))


def fit_keyframe() -> Image.Image:
    crop = subject_crop(KEYFRAME)
    scale = min(560 / crop.width, 400 / crop.height)
    fitted = crop.resize(
        (round(crop.width * scale), round(crop.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", CANVAS_SIZE, "white")
    x = round(410 - fitted.width / 2)
    y = 516 - fitted.height
    if x < 40 or y < 28 or x + fitted.width > 904 or y + fitted.height > 548:
        raise RuntimeError(f"unsafe Doubao reference margins: {(x, y, *fitted.size)}")
    canvas.paste(fitted, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"[doubao-tether-reference] {OUTPUT.name}: crop={crop.size} fitted={fitted.size} at {(x, y)}")
    return canvas


def make_contact(reference: Image.Image) -> None:
    identity = Image.open(IDENTITY).convert("RGB")
    keyframe = Image.open(KEYFRAME).convert("RGB")
    panels = [
        (identity, "identity and camera source"),
        (keyframe, "tether action keyframe v02"),
        (reference, "Doubao 1024x576 reference"),
    ]
    contact = Image.new("RGB", (1536, 336), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, (image, label) in enumerate(panels):
        image.thumbnail((512, 288), Image.Resampling.LANCZOS)
        x = index * 512 + (512 - image.width) // 2
        y = (288 - image.height) // 2
        contact.paste(image, (x, y))
        draw.text((index * 512 + 12, 304), label, fill="white")
    contact.save(CONTACT)


def main() -> None:
    if OUTPUT.exists() or CONTACT.exists():
        raise RuntimeError("refusing to overwrite an existing tether reference or gate contact")
    reference = fit_keyframe()
    make_contact(reference)


if __name__ == "__main__":
    main()
