#!/usr/bin/env python3
"""Fit the approved Polar-Night Cantor mother onto a safe 1024x576 white canvas."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = REPO / "tools/ai-gen/_frozen_normal_mothers_20260901/mother/05-polar-night-cantor-v03-structure-fixed.png"
OUTPUT = ROOT / "references/polar-night-cantor-v03-video-safe-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    rgb = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - rgb, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError(f"No non-white subject found in {SOURCE}")
    margin = 10
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    target_height = 460
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1024, 576), "white")
    x = (1024 - target_width) // 2
    y = 520 - target_height
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"[polar-night-cantor-reference] source_bbox={bbox} output_bbox={(x, y, x + target_width, y + target_height)}")


if __name__ == "__main__":
    main()
