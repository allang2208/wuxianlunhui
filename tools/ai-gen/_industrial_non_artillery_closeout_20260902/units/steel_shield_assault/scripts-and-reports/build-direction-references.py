#!/usr/bin/env python3
"""Build actual runtime-frame direction contacts for steel-shield animation work."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
OUT = ROOT / "references"

SPECS = {
    "riot_idle": {
        "path": "assets/companions/hamster_riot_squad/idle.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 8, 16, 23],
    },
    "riot_walk": {
        "path": "assets/companions/hamster_riot_squad/walking.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 8, 16, 23],
    },
    "riot_attack": {
        "path": "assets/companions/hamster_riot_squad/attacking.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 8, 17, 28, 40],
    },
    "riot_death": {
        "path": "assets/companions/hamster_riot_squad/dying.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 8, 16, 24, 30],
    },
    "phalanx_current_walk": {
        "path": "assets/companions/hamster_guard/running_rife.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 8, 16, 25, 33],
    },
    "phalanx_current_attack": {
        "path": "assets/companions/hamster_guard/attacking_rife.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 5, 11, 19, 22],
    },
    "phalanx_current_death": {
        "path": "assets/companions/hamster_guard/dying_rife.png",
        "frameWidth": 512,
        "frameHeight": 512,
        "cols": 8,
        "indices": [0, 7, 14, 21, 28],
    },
}


def checker(frame: Image.Image) -> Image.Image:
    frame = frame.convert("RGBA")
    bg = Image.new("RGB", frame.size, "#50545a")
    tile = 24
    draw = ImageDraw.Draw(bg)
    for y in range(0, frame.height, tile):
        for x in range(0, frame.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#3e4248")
    bg.paste(frame, mask=frame.getchannel("A"))
    return bg


def extract(sheet: Image.Image, spec: dict[str, object], index: int) -> Image.Image:
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    cols = int(spec["cols"])
    x = (index % cols) * width
    y = (index // cols) * height
    return sheet.crop((x, y, x + width, y + height))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "purpose": "actual approved runtime-frame direction authority",
        "references": {},
    }
    for name, spec in SPECS.items():
        source = REPO / str(spec["path"])
        sheet = Image.open(source).convert("RGBA")
        indices = [int(value) for value in spec["indices"]]
        thumbs: list[Image.Image] = []
        for index in indices:
            frame = checker(extract(sheet, spec, index))
            frame.thumbnail((320, 320), Image.Resampling.LANCZOS)
            thumbs.append(frame)
        label_height = 28
        canvas = Image.new("RGB", (320 * len(thumbs), 320 + label_height), "#20242a")
        draw = ImageDraw.Draw(canvas)
        for position, (thumb, index) in enumerate(zip(thumbs, indices)):
            x = position * 320 + (320 - thumb.width) // 2
            y = (320 - thumb.height) // 2
            canvas.paste(thumb, (x, y))
            draw.text((position * 320 + 8, 326), f"0-based frame {index}", fill="white")
        output = OUT / f"{name}-direction-contact.png"
        canvas.save(output)
        report["references"][name] = {
            "asset": str(spec["path"]),
            "frameWidth": spec["frameWidth"],
            "frameHeight": spec["frameHeight"],
            "cols": spec["cols"],
            "framesZeroBased": indices,
            "contact": output.relative_to(ROOT).as_posix(),
        }
    (OUT / "direction-reference-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
