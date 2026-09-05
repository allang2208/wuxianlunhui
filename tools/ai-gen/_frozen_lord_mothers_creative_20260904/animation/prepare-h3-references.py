#!/usr/bin/env python3
"""Fit approved action-ready sources onto stable 1024x576 H3 canvases."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "reference-source"
OUT = ROOT / "references"
CANVAS = (1024, 576)

SPECS = [
    {
        "source": "01-snow-sepulcher-carrier-action-ready-v03.png",
        "output": "01-snow-sepulcher-carrier-locomotion-1024x576.png",
        "max_size": (590, 430),
        "center_x": 465,
        "foot_y": 522,
        "label": "01 carrier / advance",
    },
    {
        "source": "02-aurora-fate-weaver-action-ready-v02.png",
        "output": "02-aurora-fate-weaver-locomotion-1024x576.png",
        "max_size": (570, 420),
        "center_x": 465,
        "foot_y": 520,
        "label": "02 weaver / seek_band",
    },
    {
        "source": "03-white-silence-bell-hart-action-ready-v01.png",
        "output": "03-white-silence-bell-hart-locomotion-1024x576.png",
        "max_size": (530, 430),
        "center_x": 470,
        "foot_y": 522,
        "label": "03 bell hart / stride",
    },
    {
        "source": "04-permafrost-chasm-maw-action-ready-v02.png",
        "output": "04-permafrost-chasm-maw-locomotion-1024x576.png",
        "max_size": (650, 350),
        "center_x": 455,
        "foot_y": 500,
        "label": "04 chasm maw / crawl",
    },
    {
        "source": "05-frozen-sun-core-relic-action-ready-v01.png",
        "output": "05-frozen-sun-core-relic-cold-move-1024x576.png",
        "max_size": (500, 410),
        "center_x": 512,
        "foot_y": 510,
        "label": "05 core relic / cold_move",
    },
]


def subject_crop(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    ys, xs = np.where(distance > 14.0)
    if not len(xs):
        raise ValueError("source image has no detectable subject")
    pad = 18
    bounds = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(image.width, int(xs.max()) + pad + 1),
        min(image.height, int(ys.max()) + pad + 1),
    )
    return image.convert("RGB").crop(bounds)


def fit(spec: dict[str, object]) -> Image.Image:
    source = subject_crop(Image.open(SOURCE / str(spec["source"])))
    max_width, max_height = spec["max_size"]
    scale = min(max_width / source.width, max_height / source.height)
    fitted = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", CANVAS, "white")
    x = round(int(spec["center_x"]) - fitted.width / 2)
    y = int(spec["foot_y"]) - fitted.height
    if x < 40 or y < 28 or x + fitted.width > CANVAS[0] - 40 or y + fitted.height > CANVAS[1] - 28:
        raise ValueError(f"unsafe margins for {spec['output']}: {(x, y, fitted.width, fitted.height)}")
    canvas.paste(fitted, (x, y))
    canvas.save(OUT / str(spec["output"]), quality=100)
    print(f"[h3-reference] {spec['output']}: source={source.size} fitted={fitted.size} at {(x, y)}")
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = [(spec, fit(spec)) for spec in SPECS]
    contact = Image.new("RGB", (1024, 5 * 320), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, (spec, canvas) in enumerate(outputs):
        preview = canvas.resize((512, 288), Image.Resampling.LANCZOS)
        y = row * 320
        contact.paste(preview, (256, y))
        draw.text((20, y + 12), str(spec["label"]), fill="white")
    contact.save(OUT / "locomotion-reference-contact.png")


if __name__ == "__main__":
    main()
