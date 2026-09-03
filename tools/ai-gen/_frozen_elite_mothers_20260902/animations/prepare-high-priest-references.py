#!/usr/bin/env python3
"""Fit approved High Priest identity/action references onto safe 1024x576 canvases."""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
JOBS = {
    TASK / "mother/05-polar-night-high-priest-v04-project-three-quarter-candidate.png":
        ROOT / "references/polar-night-high-priest-mother-video-safe-1024x576.png",
    ROOT / "references/polar-night-high-priest-running-keyframe-v01-source.png":
        ROOT / "references/polar-night-high-priest-running-keyframe-v01-video-safe-1024x576.png",
    ROOT / "references/polar-night-high-priest-attacking-keyframe-v01-source.png":
        ROOT / "references/polar-night-high-priest-attacking-keyframe-v01-video-safe-1024x576.png",
}


def fit(source_path: Path, output_path: Path) -> None:
    source = Image.open(source_path).convert("RGB")
    rgb = np.asarray(source, dtype=np.int16)
    distance = np.max(255 - rgb, axis=2)
    ys, xs = np.where(distance > 15)
    if not len(xs):
        raise RuntimeError(f"No non-white subject found in {source_path}")
    margin = 10
    bbox = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(source.width, int(xs.max()) + 1 + margin),
        min(source.height, int(ys.max()) + 1 + margin),
    )
    subject = source.crop(bbox)
    scale = min(480 / subject.height, 900 / subject.width)
    target = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1024, 576), "white")
    x = (1024 - target[0]) // 2
    y = 525 - target[1]
    canvas.paste(subject, (x, y))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, quality=100)
    print(f"[high-priest-reference] {source_path.name} source_bbox={bbox} output_bbox={(x, y, x + target[0], y + target[1])}")


def main() -> None:
    for source, output in JOBS.items():
        fit(source, output)


if __name__ == "__main__":
    main()
