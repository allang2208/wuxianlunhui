#!/usr/bin/env python3
"""Place the current approved black-wolf idle art on a safe 16:9 white canvas."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = REPO / "assets/enemies/black_wolf_idle.png"
OUTPUT = ROOT / "references/black-wolf-death-reference-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    alpha = np.asarray(source)[..., 3]
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError(f"No visible subject found in {SOURCE}")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject = source.crop(bbox)
    target_width = 390
    target_height = round(subject.height * target_width / subject.width)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (1024, 576), (255, 255, 255, 255))
    # Right-facing wolf starts slightly left of center, leaving collapse room ahead.
    x = 214
    foot_y = 438
    y = foot_y - target_height
    canvas.alpha_composite(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUTPUT, quality=100)
    print({
        "source": str(SOURCE),
        "sourceBbox": bbox,
        "output": str(OUTPUT),
        "outputBbox": (x, y, x + target_width, foot_y),
        "rightMargin": 1024 - x - target_width,
    })


if __name__ == "__main__":
    main()
