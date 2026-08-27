#!/usr/bin/env python3
"""Turn a useful v01 walk pose into a clean, wide action-keyframe reference."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "references" / "moving-v01-review-frames" / "moving-v01-f060.png"
OUTPUT = ROOT / "references" / "hamster-crossbow-moving-keyframe-v02-1024x576.png"


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    rgb = np.asarray(source, dtype=np.int16)
    corners = np.concatenate([
        rgb[:48, :48].reshape(-1, 3),
        rgb[:48, -48:].reshape(-1, 3),
        rgb[-48:, :48].reshape(-1, 3),
        rgb[-48:, -48:].reshape(-1, 3),
    ])
    background = np.median(corners, axis=0)
    distance = np.sqrt(((rgb - background) ** 2).sum(axis=2))
    alpha = np.clip((distance - 24.0) * 12.0, 0, 255).astype(np.uint8)
    alpha_image = Image.fromarray(alpha, "L")

    # Seedance added a rat-like tail that is absent from the approved mother.
    # Remove only that narrow rear appendage before using this pose as guidance.
    erase = Image.new("L", source.size, 0)
    ImageDraw.Draw(erase).polygon(
        [(344, 535), (382, 534), (430, 550), (492, 564), (495, 585),
         (452, 591), (391, 576), (344, 565)],
        fill=255,
    )
    erase = erase.filter(ImageFilter.GaussianBlur(3))
    alpha_image = Image.composite(Image.new("L", source.size, 0), alpha_image, erase)

    cutout = source.convert("RGBA")
    cutout.putalpha(alpha_image)
    # The decoded Doubao source is 1280x720. Use the known full-figure region so
    # low-level video noise at the canvas edges cannot inflate the cutout bbox.
    bbox = (340, 30, 1050, 690)
    subject = cutout.crop(bbox)
    target_width = 350
    target_height = round(subject.height * target_width / subject.width)
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (1024, 576), (255, 255, 255, 255))
    x = 205
    y = 466 - target_height
    canvas.alpha_composite(subject, (x, y))
    final_erase = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(final_erase).rectangle((200, 378, 270, 417), fill=255)
    canvas = Image.composite(Image.new("RGBA", canvas.size, (255, 255, 255, 255)), canvas, final_erase)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUTPUT)
    print(f"saved {OUTPUT} from bbox={bbox}, output_bbox={(x, y, x + target_width, y + target_height)}")


if __name__ == "__main__":
    main()
