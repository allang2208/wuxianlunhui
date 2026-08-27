#!/usr/bin/env python3
"""Place the approved longbow mother in a safe 16:9 Doubao video frame."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "mother" / "hamster-longbow-mother-v04-infantry-view-candidate.png"
OUTPUT = ROOT / "references" / "hamster-longbow-safe-white-1024x576.png"


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
    subject_rgb = np.asarray(source.crop(bbox), dtype=np.uint8).copy()
    channel_spread = subject_rgb.max(axis=2) - subject_rgb.min(axis=2)
    near_white = ((subject_rgb.min(axis=2) > 235) & (channel_spread < 18)).astype(np.uint8)
    count, labels = cv2.connectedComponents(near_white, 8)
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border_labels.discard(0)
    if border_labels:
        background = np.isin(labels, list(border_labels))
        subject_rgb[background] = 255
    subject = Image.fromarray(subject_rgb, "RGB")
    target_height = 370
    target_width = round(subject.width * target_height / subject.height)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1024, 576), (255, 255, 255))
    x = (1024 - target_width) // 2
    y = 486 - target_height
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(f"saved {OUTPUT} source_bbox={bbox} output_bbox={(x, y, x + target_width, y + target_height)}")


if __name__ == "__main__":
    main()
