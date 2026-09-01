#!/usr/bin/env python3
"""Build the champion UI icon from the approved plate-armored idle frame."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
CONFIG_PATH = REPO / "data" / "hamster-champion-config.json"
OUTPUT = REPO / "assets" / "ui" / "unit-icons" / "hamster-champion.png"
REPORT = ROOT / "runtime-icon-report.json"


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    idle = config["animations"]["idle"]
    width = int(idle["frameWidth"])
    height = int(idle["frameHeight"])
    sheet = Image.open(REPO / idle["src"]).convert("RGBA")
    frame = sheet.crop((0, 0, width, height))
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("champion idle frame 0 is empty")

    padding = 16
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(width, bbox[2] + padding)
    bottom = min(height, bbox[3] + padding)
    subject = frame.crop((left, top, right, bottom))
    scale = min(480 / subject.width, 480 / subject.height)
    resized = subject.resize(
        (round(subject.width * scale), round(subject.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(
        resized,
        ((512 - resized.width) // 2, (512 - resized.height) // 2),
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, optimize=True, compress_level=9)
    REPORT.write_text(
        json.dumps(
            {
                "source": idle["src"],
                "sourceFrame": 0,
                "sourceFrameSize": [width, height],
                "sourceAlphaBbox": list(bbox),
                "cropWithPadding": [left, top, right, bottom],
                "output": str(OUTPUT.relative_to(REPO)).replace("\\", "/"),
                "outputSize": [512, 512],
                "identity": "approved refined full plate and closed-helmet champion",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
