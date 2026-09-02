#!/usr/bin/env python3
"""Build 512px transparent UI icons for the three newly integrated units."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
ICON_ROOT = REPO / "assets/ui/unit-icons"
SPECS = {
    "anti_tank_rifleman": (
        REPO / "tools/ai-gen/_industrial_recon_mothers_20260831/mother/anti_tank_rifleman-mother-v02-soviet-ppsh.png",
        ICON_ROOT / "hamster-anti-tank-rifleman.png",
        430,
    ),
    "industrial_recon_rifleman": (
        REPO / "tools/ai-gen/_industrial_recon_mothers_20260831/mother/industrial_recon_rifleman-mother-v02-soviet-mosin.png",
        ICON_ROOT / "hamster-industrial-recon-rifleman.png",
        430,
    ),
    "steel_shield_assault": (
        REPO / "tools/ai-gen/_industrial_infantry_mothers_20260831/mother/steel_shield_assault-mother-v01.png",
        ICON_ROOT / "hamster-steel-shield-assault.png",
        430,
    ),
}


def white_cutout(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB")).copy()
    work = rgb.astype(np.float32)
    distance = np.sqrt(np.sum((255 - work) ** 2, axis=2))
    alpha = np.clip((distance - 8.0) / 30.0 * 255.0, 0, 255).astype(np.uint8)
    alpha[alpha < 4] = 0
    rgba = np.dstack((rgb, alpha))
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    ICON_ROOT.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "date": "2026-09-02", "icons": {}}
    for unit_key, (source, output, target_height) in SPECS.items():
        cutout = white_cutout(Image.open(source))
        bbox = cutout.getbbox()
        if bbox is None:
            raise RuntimeError(f"empty mother image: {source}")
        crop = cutout.crop(bbox)
        scale = min(460 / crop.width, target_height / crop.height)
        resized = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        x = (512 - resized.width) // 2
        y = 494 - resized.height
        canvas.alpha_composite(resized, (x, y))
        canvas.save(output, optimize=True, compress_level=9)
        report["icons"][unit_key] = {
            "source": source.relative_to(REPO).as_posix(),
            "output": output.relative_to(REPO).as_posix(),
            "sourceAlphaBBox": list(bbox),
            "placedBBox": list(canvas.getbbox() or ()),
        }
        print(f"[icon] {unit_key} -> {output.name} bbox={canvas.getbbox()}", flush=True)
    (ROOT / "remaining-runtime-icon-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
