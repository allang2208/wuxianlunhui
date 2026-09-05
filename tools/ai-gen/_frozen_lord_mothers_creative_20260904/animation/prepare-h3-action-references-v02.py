#!/usr/bin/env python3
"""Fit the second signature-action gate candidates onto safe H3 canvases."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "action-keyframes"
OUT = ROOT / "action-references"
CANVAS = (1024, 576)

SPECS = [
    {
        "source": "01-snow-sepulcher-carrier-plow-prepare-v01.png",
        "output": "01-snow-sepulcher-carrier-plow-windup-v02-1024x576.png",
        "max_size": (520, 420),
        "center_x": 355,
        "foot_y": 522,
        "label": "01 carrier / plow_windup v02 / recover",
    },
    {
        "source": "02-aurora-fate-weaver-triangle-prepare-v01.png",
        "output": "02-aurora-fate-weaver-body-cast-v02-1024x576.png",
        "max_size": (560, 400),
        "center_x": 365,
        "foot_y": 516,
        "label": "02 weaver / body_cast v02 / recover",
    },
    {
        "source": "05-frozen-sun-core-relic-cold-idle-prepare-v02.png",
        "output": "05-frozen-sun-core-relic-cold-idle-v02-1024x576.png",
        "max_size": (500, 420),
        "center_x": 420,
        "foot_y": 520,
        "label": "05 core relic / cold_idle v02 / loop",
    },
]


def subject_crop(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    ys, xs = np.where(distance > 14.0)
    if not len(xs):
        raise ValueError("source image has no detectable subject")
    pad = 18
    return image.convert("RGB").crop((
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(image.width, int(xs.max()) + pad + 1),
        min(image.height, int(ys.max()) + pad + 1),
    ))


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
    if x < 40 or y < 28 or x + fitted.width > CANVAS[0] - 120 or y + fitted.height > CANVAS[1] - 28:
        raise ValueError(f"unsafe action margins for {spec['output']}: {(x, y, fitted.width, fitted.height)}")
    canvas.paste(fitted, (x, y))
    canvas.save(OUT / str(spec["output"]), quality=100)
    print(f"[h3-action-reference-v02] {spec['output']}: source={source.size} fitted={fitted.size} at {(x, y)}")
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = [(spec, fit(spec)) for spec in SPECS]
    contact = Image.new("RGB", (1024, len(outputs) * 320), "#20242a")
    draw = ImageDraw.Draw(contact)
    for row, (spec, canvas) in enumerate(outputs):
        y = row * 320
        contact.paste(canvas.resize((512, 288), Image.Resampling.LANCZOS), (256, y))
        draw.text((20, y + 12), str(spec["label"]), fill="white")
    contact.save(OUT / "signature-action-reference-v02-contact.png")


if __name__ == "__main__":
    main()
