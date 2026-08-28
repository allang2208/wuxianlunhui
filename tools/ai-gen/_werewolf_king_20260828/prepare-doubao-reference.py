#!/usr/bin/env python3
"""Place the approved armored Werewolf King mother in a safe 16:9 video frame."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "werewolf-king-mother-v02-armored-candidate.png"
OUTPUT = ROOT / "references" / "werewolf-king-armored-safe-white-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    pixels = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - pixels, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError("armored mother contains no visible subject")

    margin = 10
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    target_height = 360
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)

    subject_pixels = np.asarray(subject).copy()
    channel_spread = subject_pixels.max(axis=2) - subject_pixels.min(axis=2)
    near_white = (subject_pixels.min(axis=2) >= 244) & (channel_spread <= 10)
    subject_pixels[near_white] = 255
    subject = Image.fromarray(subject_pixels, "RGB")

    canvas = Image.new("RGB", (1024, 576), "white")
    baseline_y = 500
    x = (1024 - target_width) // 2
    y = baseline_y - target_height
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"saved {OUTPUT} source_bbox={bbox} output_bbox={(x, y, x + target_width, baseline_y)}")


if __name__ == "__main__":
    main()
