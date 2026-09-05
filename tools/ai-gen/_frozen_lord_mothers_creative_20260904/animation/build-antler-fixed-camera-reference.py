#!/usr/bin/env python3
"""Add removable background registration marks for the antler fixed-camera H3 pass."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "references" / "03-white-silence-bell-hart-locomotion-1024x576.png"
OUTPUT = ROOT / "references" / "03-white-silence-bell-hart-locomotion-fixed-camera-1024x576.png"
MANIFEST = OUTPUT.with_suffix(".json")


def main() -> None:
    image = Image.open(SOURCE).convert("RGB")
    if image.size != (1024, 576):
        raise RuntimeError(f"unexpected source size: {image.size}")

    draw = ImageDraw.Draw(image)
    pale = (220, 236, 242)
    strong = (158, 197, 211)

    # All marks remain outside the creature and are only camera-registration evidence.
    draw.rectangle((22, 22, 1001, 553), outline=pale, width=2)
    draw.line((36, 540, 988, 540), fill=pale, width=2)
    for x in range(128, 897, 128):
        draw.line((x, 534, x, 546), fill=pale, width=2)

    for x, y, sx, sy in ((36, 36, 1, 1), (988, 36, -1, 1), (36, 540, 1, -1), (988, 540, -1, -1)):
        draw.line((x, y, x + sx * 28, y), fill=strong, width=3)
        draw.line((x, y, x, y + sy * 28), fill=strong, width=3)

    image.save(OUTPUT)
    MANIFEST.write_text(
        json.dumps(
            {
                "source": SOURCE.name,
                "output": OUTPUT.name,
                "purpose": "temporary fixed-camera registration reference for H3; not runtime art",
                "imageTransform": "none",
                "subjectPixels": "unchanged",
                "backgroundMarks": {
                    "outerFrame": [22, 22, 1001, 553],
                    "baselineY": 540,
                    "cornerBrackets": "outside subject",
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(OUTPUT)
    print(MANIFEST)


if __name__ == "__main__":
    main()
