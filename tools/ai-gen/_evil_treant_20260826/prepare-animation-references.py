#!/usr/bin/env python3
"""Combine the accepted mother RGB with BiRefNet alpha and build H3-safe canvases."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
MOTHER = ROOT / "mother" / "evil-treant-mother-v03-photorealistic-white.png"
ALPHA = ROOT / "references" / "evil-treant-mother-v03-birefnet-alpha.png"
OUT_DIR = ROOT / "references"
BACKGROUND = (0, 255, 255, 255)
CANVAS = (1024, 576)


def bbox_from_alpha(alpha: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("BiRefNet alpha has no visible subject")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def make_reference(
    cutout: Image.Image,
    output: Path,
    target_height_ratio: float,
    anchor_x_ratio: float,
    foot_y_ratio: float,
) -> dict:
    x0, y0, x1, y1 = bbox_from_alpha(np.asarray(cutout.getchannel("A")))
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
    cutout_path = OUT_DIR / "evil-treant-mother-v03-cutout.png"
    rgba.save(cutout_path)

    specs = {
        "loop": (0.72, 0.42, 0.86),
        "attack": (0.66, 0.34, 0.84),
        "dying": (0.60, 0.43, 0.80),
    }
    report = {
        "mother": str(MOTHER.relative_to(ROOT)),
        "alpha": str(ALPHA.relative_to(ROOT)),
        "cutout": str(cutout_path.relative_to(ROOT)),
        "background": "#00FFFF",
        "references": {},
    }
    for name, (height, anchor_x, foot_y) in specs.items():
        output = OUT_DIR / f"evil-treant-h3-reference-{name}-cyan.png"
        report["references"][name] = make_reference(
            rgba, output, height, anchor_x, foot_y
        )

    report_path = OUT_DIR / "reference-preparation-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
