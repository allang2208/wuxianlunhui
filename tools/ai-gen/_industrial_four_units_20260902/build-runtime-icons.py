#!/usr/bin/env python3
"""Build 512px transparent UI icons from the four approved mother images."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
ICON_ROOT = REPO / "assets/ui/unit-icons"
SPECS = {
    "service_rifleman": (
        REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/mother/service_rifleman-mother-v01.png",
        ICON_ROOT / "hamster-service-rifleman.png",
        430,
    ),
    "emplaced_machine_gun_crew": (
        REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/mother/emplaced_machine_gun_crew-mother-v06-backpack.png",
        ICON_ROOT / "hamster-bar-automatic-rifleman.png",
        430,
    ),
    "industrial_carbine_cavalry": (
        REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/mother/industrial_carbine_cavalry-mother-v02-cavalry-camera.png",
        ICON_ROOT / "hamster-industrial-carbine-cavalry.png",
        452,
    ),
    "gunpowder_explosive_lancer": (
        REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/mother/gunpowder_explosive_lancer-mother-v03-cavalry-camera.png",
        ICON_ROOT / "hamster-industrial-heavy-lancer.png",
        452,
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
            "source": str(source.relative_to(REPO)).replace("\\", "/"),
            "output": str(output.relative_to(REPO)).replace("\\", "/"),
            "sourceAlphaBBox": list(bbox),
            "placedBBox": list(canvas.getbbox() or ()),
        }
        print(f"[icon] {unit_key} -> {output.name} bbox={canvas.getbbox()}", flush=True)
    (ROOT / "runtime-icon-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
