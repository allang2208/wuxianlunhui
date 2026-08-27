#!/usr/bin/env python3
"""Build fixed-identity Seedance references for the stationary purple-blight treant."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
MOTHER = ROOT / "mother" / "purple-blight-ancient-mother-v03-stationary-photorealistic-white.png"
ALPHA = ROOT / "references" / "purple-blight-ancient-mother-v03-alpha.png"
OUT_DIR = ROOT / "references"
CANVAS = (1024, 576)
BACKGROUND = (255, 0, 255, 255)


def visible_bbox(alpha: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("BiRefNet alpha contains no visible subject")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def build_reference(cutout: Image.Image, name: str, height_ratio: float, anchor_x: float, foot_y: float) -> dict:
    x0, y0, x1, y1 = visible_bbox(np.asarray(cutout.getchannel("A")))
    subject = cutout.crop((x0, y0, x1, y1))
    target_height = round(CANVAS[1] * height_ratio)
    scale = target_height / subject.height
    size = (round(subject.width * scale), target_height)
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    dst_x = max(0, min(CANVAS[0] - size[0], round(CANVAS[0] * anchor_x - size[0] / 2)))
    dst_y = max(0, min(CANVAS[1] - size[1], round(CANVAS[1] * foot_y - size[1])))
    canvas = Image.new("RGBA", CANVAS, BACKGROUND)
    canvas.alpha_composite(subject, (dst_x, dst_y))
    output = OUT_DIR / f"purple-blight-ancient-reference-{name}-magenta.png"
    canvas.convert("RGB").save(output)
    return {
        "file": str(output.relative_to(ROOT)),
        "canvas": list(CANVAS),
        "subjectBbox": [dst_x, dst_y, dst_x + size[0], dst_y + size[1]],
        "margins": {"left": dst_x, "right": CANVAS[0] - dst_x - size[0], "top": dst_y, "bottom": CANVAS[1] - dst_y - size[1]},
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rgb = Image.open(MOTHER).convert("RGB")
    alpha = Image.open(ALPHA).convert("L")
    if rgb.size != alpha.size:
        raise ValueError(f"RGB/alpha size mismatch: {rgb.size} vs {alpha.size}")
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    cutout = OUT_DIR / "purple-blight-ancient-mother-v03-cutout.png"
    rgba.save(cutout)
    specs = {
        "idle": (0.78, 0.42, 0.90),
        "spellcast": (0.69, 0.42, 0.88),
        "attack": (0.65, 0.39, 0.87),
        "throw": (0.62, 0.36, 0.86),
        "death": (0.58, 0.43, 0.82),
    }
    report = {"mother": str(MOTHER.relative_to(ROOT)), "alpha": str(ALPHA.relative_to(ROOT)), "cutout": str(cutout.relative_to(ROOT)), "background": "#FF00FF", "references": {}}
    for name, spec in specs.items():
        report["references"][name] = build_reference(rgba, name, *spec)
    (OUT_DIR / "reference-preparation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
