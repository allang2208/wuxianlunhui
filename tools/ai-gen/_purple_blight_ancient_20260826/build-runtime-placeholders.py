#!/usr/bin/env python3
"""Build one-frame runtime placeholders from the accepted mother until videos are approved."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
CUTOUT = ROOT / "references" / "purple-blight-ancient-mother-v03-cutout.png"
OUT_DIR = ROOT.parents[2] / "assets" / "enemies" / "purple_blight_ancient"


def main() -> None:
    image = Image.open(CUTOUT).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 16)
    if not len(xs):
        raise ValueError("accepted mother cutout is empty")
    subject = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    target_height = 476
    scale = target_height / subject.height
    subject = subject.resize((round(subject.width * scale), target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((512 - subject.width) // 2, 500 - subject.height))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for state in ("idle", "spellcast", "attack", "throw", "death"):
        canvas.save(OUT_DIR / f"{state}.png")
    print(f"placeholder sheets -> {OUT_DIR}")


if __name__ == "__main__":
    main()
