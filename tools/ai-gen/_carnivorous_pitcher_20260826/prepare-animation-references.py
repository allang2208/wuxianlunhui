#!/usr/bin/env python3
"""Build fixed-identity, safe-margin Seedance references from the accepted mother."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
MOTHER = ROOT / "mother" / "carnivorous-pitcher-mother-v03-photorealistic-white.png"
ALPHA = ROOT / "references" / "carnivorous-pitcher-mother-v03-alpha.png"
OUT_DIR = ROOT / "references"
CANVAS = (1024, 576)
BACKGROUND = (255, 0, 255, 255)


def visible_bbox(alpha: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("BiRefNet alpha contains no visible subject")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def build_reference(
    cutout: Image.Image,
    name: str,
    target_height_ratio: float,
    anchor_x_ratio: float,
    foot_y_ratio: float,
) -> dict:
    x0, y0, x1, y1 = visible_bbox(np.asarray(cutout.getchannel("A")))
    subject = cutout.crop((x0, y0, x1, y1))
    target_height = round(CANVAS[1] * target_height_ratio)
    scale = target_height / subject.height
    target_size = (round(subject.width * scale), target_height)
    subject = subject.resize(target_size, Image.Resampling.LANCZOS)

    dst_x = round(CANVAS[0] * anchor_x_ratio - target_size[0] / 2)
    dst_y = round(CANVAS[1] * foot_y_ratio - target_size[1])
    dst_x = max(0, min(CANVAS[0] - target_size[0], dst_x))
    dst_y = max(0, min(CANVAS[1] - target_size[1], dst_y))

    canvas = Image.new("RGBA", CANVAS, BACKGROUND)
    canvas.alpha_composite(subject, (dst_x, dst_y))
    output = OUT_DIR / f"carnivorous-pitcher-reference-{name}-magenta.png"
    canvas.convert("RGB").save(output)
    return {
        "file": str(output.relative_to(ROOT)),
        "canvas": list(CANVAS),
        "subjectBbox": [dst_x, dst_y, dst_x + target_size[0], dst_y + target_size[1]],
        "subjectHeightRatio": target_size[1] / CANVAS[1],
        "margins": {
            "left": dst_x,
            "right": CANVAS[0] - dst_x - target_size[0],
            "top": dst_y,
            "bottom": CANVAS[1] - dst_y - target_size[1],
        },
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rgb = Image.open(MOTHER).convert("RGB")
    alpha = Image.open(ALPHA).convert("L")
    if rgb.size != alpha.size:
        raise ValueError(f"RGB/alpha size mismatch: {rgb.size} vs {alpha.size}")

    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    cutout = OUT_DIR / "carnivorous-pitcher-mother-v03-cutout.png"
    rgba.save(cutout)

    specs = {
        "idle": (0.76, 0.43, 0.88),
        "walking": (0.72, 0.43, 0.87),
        "attacking": (0.63, 0.33, 0.84),
        "dying": (0.59, 0.43, 0.80),
    }
    report = {
        "mother": str(MOTHER.relative_to(ROOT)),
        "alpha": str(ALPHA.relative_to(ROOT)),
        "cutout": str(cutout.relative_to(ROOT)),
        "background": "#FF00FF",
        "references": {},
    }
    for name, spec in specs.items():
        report["references"][name] = build_reference(rgba, name, *spec)

    report_path = OUT_DIR / "reference-preparation-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
