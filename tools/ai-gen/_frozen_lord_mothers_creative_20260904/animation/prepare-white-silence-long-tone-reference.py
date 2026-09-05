#!/usr/bin/env python3
"""Fit the approved long-tone keyframe to a 1024x576 H3 canvas without stretching."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "action-keyframes" / "03-white-silence-bell-hart-long-tone-prepare-v01.png"
OUTPUT = ROOT / "action-references" / "03-white-silence-bell-hart-long-tone-prepare-v01-1024x576.png"
MANIFEST = OUTPUT.with_suffix(".json")
CANVAS = (1024, 576)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    scale = min(CANVAS[0] / source.width, CANVAS[1] / source.height)
    fitted_size = (round(source.width * scale), round(source.height * scale))
    fitted = source.resize(fitted_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", CANVAS, "white")
    paste = ((CANVAS[0] - fitted.width) // 2, (CANVAS[1] - fitted.height) // 2)
    canvas.paste(fitted, paste)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT)
    MANIFEST.write_text(
        json.dumps(
            {
                "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
                "output": str(OUTPUT.relative_to(ROOT)).replace("\\", "/"),
                "sourceSize": list(source.size),
                "canvasSize": list(CANVAS),
                "scale": scale,
                "fittedSize": list(fitted_size),
                "paste": list(paste),
                "transform": "uniform scale plus white letterbox only; no crop or non-uniform stretch",
                "purpose": "approved long_tone_body H3 first-and-last reference",
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
