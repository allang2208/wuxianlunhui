#!/usr/bin/env python3
"""Place the approved compact hamster-assault mother in a safe 16:9 video frame."""

from __future__ import annotations

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
    / "hamster-assault-mother-v03-compact-body-white.png"
)
OUTPUT = ROOT / "references" / "hamster-assault-compact-white-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    rgb = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - rgb, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError(f"no non-white subject found in {SOURCE}")

    margin = 8
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    target_height = 415
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (1024, 576), (255, 255, 255))
    x = 205
    y = 507 - target_height
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"saved {OUTPUT} source_bbox={bbox} output_bbox={(x, y, x + target_width, y + target_height)}")


if __name__ == "__main__":
    main()
