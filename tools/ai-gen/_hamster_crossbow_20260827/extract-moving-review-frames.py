#!/usr/bin/env python3
"""Extract full-resolution moving frames for action-keyframe review."""

from __future__ import annotations

from pathlib import Path

import av
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "moving-doubao-v02.mp4"
OUTPUT = ROOT / "references" / "moving-v02-review-frames"
SELECTED = {24, 36, 48, 60, 72, 84, 96}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with av.open(str(SOURCE)) as container:
        stream = container.streams.video[0]
        for index, frame in enumerate(container.decode(stream)):
            if index not in SELECTED:
                continue
            image = Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
            image.save(OUTPUT / f"moving-v02-f{index:03d}.png")
    print(f"extracted {len(list(OUTPUT.glob('moving-v02-f*.png')))} review frames to {OUTPUT}")


if __name__ == "__main__":
    main()
