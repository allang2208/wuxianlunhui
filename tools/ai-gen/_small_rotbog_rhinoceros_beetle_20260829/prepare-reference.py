#!/usr/bin/env python3
"""Combine the approved mother RGB with its BiRefNet mask for Doubao I2V."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
MOTHER = ROOT / "mother" / "small-rotbog-rhinoceros-beetle-mother-v02-white-approved.png"
MASK = ROOT / "references" / "small-rotbog-rhinoceros-beetle-mother-v02-birefnet-mask.png"
CUTOUT = ROOT / "references" / "small-rotbog-rhinoceros-beetle-mother-v02-cutout.png"
SAFE_BLUE = ROOT / "references" / "small-rotbog-rhinoceros-beetle-safe-blue-1024x576.png"

CANVAS = (1024, 576)
SUBJECT_WIDTH_RATIO = 0.62
ANCHOR_X_RATIO = 0.45
FOOT_Y_RATIO = 0.80
BLUE = (0, 0, 255, 255)


def main() -> None:
    mother = Image.open(MOTHER).convert("RGBA")
    mask = Image.open(MASK).convert("L")
    if mask.size != mother.size:
        mask = mask.resize(mother.size, Image.Resampling.BILINEAR)

    cutout = mother.copy()
    cutout.putalpha(mask)
    CUTOUT.parent.mkdir(parents=True, exist_ok=True)
    cutout.save(CUTOUT)

    bbox = mask.point(lambda value: 255 if value > 8 else 0).getbbox()
    if not bbox:
        raise RuntimeError("BiRefNet mask contains no visible beetle")
    subject = cutout.crop(bbox)

    target_w = round(CANVAS[0] * SUBJECT_WIDTH_RATIO)
    scale = target_w / subject.width
    target_h = round(subject.height * scale)
    max_h = round(CANVAS[1] * 0.72)
    if target_h > max_h:
        scale = max_h / subject.height
        target_w = round(subject.width * scale)
        target_h = max_h
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)

    x = round(CANVAS[0] * ANCHOR_X_RATIO - target_w / 2)
    y = round(CANVAS[1] * FOOT_Y_RATIO - target_h)
    x = max(0, min(CANVAS[0] - target_w, x))
    y = max(0, min(CANVAS[1] - target_h, y))
    canvas = Image.new("RGBA", CANVAS, BLUE)
    canvas.alpha_composite(subject, (x, y))
    canvas.convert("RGB").save(SAFE_BLUE)

    print(json.dumps({
        "mother": str(MOTHER),
        "mask": str(MASK),
        "cutout": str(CUTOUT),
        "safeReference": str(SAFE_BLUE),
        "sourceBbox": list(bbox),
        "canvas": list(CANVAS),
        "outputBbox": [x, y, x + target_w, y + target_h],
        "margins": {
            "left": x,
            "right": CANVAS[0] - x - target_w,
            "top": y,
            "bottom": CANVAS[1] - y - target_h,
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
