#!/usr/bin/env python3
"""Place the approved powered EOD explosive lancer mother in a safe H3 frame."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = (
    REPO
    / "tools"
    / "ai-gen"
    / "_hamster_missing_mothers_20260826"
    / "mother"
    / "hamster-powered-eod-explosive-lancer-mother-v02-white.png"
)
OUTPUT = ROOT / "references" / "hamster-powered-eod-explosive-lancer-safe-white-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    pixels = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - pixels, axis=2)
    ys, xs = np.where(distance > 12)
    if not len(xs):
        raise RuntimeError("approved mother contains no visible subject")

    margin = 12
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    target_height = 420
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    subject_pixels = np.asarray(subject).copy()
    near_white = (
        (subject_pixels.min(axis=2) >= 244)
        & ((subject_pixels.max(axis=2) - subject_pixels.min(axis=2)) <= 8)
    )
    subject_pixels[near_white] = 255
    subject = Image.fromarray(subject_pixels, "RGB")

    x = 165
    baseline_y = 515
    y = baseline_y - target_height
    if x + target_width > 954:
        raise RuntimeError("reference subject exceeds the right-side safety margin")

    canvas = Image.new("RGB", (1024, 576), "white")
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"saved {OUTPUT} source_bbox={bbox} output_bbox={(x, y, x + target_width, baseline_y)}")


if __name__ == "__main__":
    main()
