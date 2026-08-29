#!/usr/bin/env python3
"""Build a left-biased 16:9 safety reference for the beam-thrust attack."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "mother" / "support-beam-brute-mother-v01.png"
OUTPUT = ROOT / "mother" / "support-beam-brute-attack-safe-white-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    pixels = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - pixels, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError("support-beam mother contains no visible subject")

    margin = 8
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    target_height = 330
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (1024, 576), "white")
    center_x = 230
    baseline_y = 510
    x = round(center_x - target_width / 2)
    y = baseline_y - target_height
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(
        f"saved {OUTPUT} source_bbox={bbox} "
        f"output_bbox={(x, y, x + target_width, baseline_y)}"
    )


if __name__ == "__main__":
    main()
