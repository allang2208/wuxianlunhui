#!/usr/bin/env python3
"""Prepare fixed 16:9 H3 references without stretching the approved artwork."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SIZE = (1024, 576)

UNITS = {
    "service_rifleman": {
        "root": REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/animations/service_rifleman",
        "idle": REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/mother/service_rifleman-mother-v01.png",
    },
    "emplaced_machine_gun_crew": {
        "root": REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/animations/emplaced_machine_gun_crew",
        "idle": REPO / "tools/ai-gen/_industrial_shooting_mothers_20260831/mother/emplaced_machine_gun_crew-mother-v06-backpack.png",
    },
    "industrial_carbine_cavalry": {
        "root": REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/animations/industrial_carbine_cavalry",
        "idle": REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/mother/industrial_carbine_cavalry-mother-v02-cavalry-camera.png",
    },
    "gunpowder_explosive_lancer": {
        "root": REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/animations/gunpowder_explosive_lancer",
        "idle": REPO / "tools/ai-gen/_industrial_cavalry_mothers_20260831/mother/gunpowder_explosive_lancer-mother-v03-cavalry-camera.png",
    },
}


def visible_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = np.asarray(image.convert("RGB"))
    mask = np.min(rgb, axis=2) < 246
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return (0, 0, image.width, image.height)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def prepare(source: Path, output: Path, width_ratio: float, height_ratio: float) -> dict[str, object]:
    image = Image.open(source).convert("RGB")
    bbox = visible_bbox(image)
    crop = image.crop(bbox)
    scale = min(SIZE[0] * width_ratio / crop.width, SIZE[1] * height_ratio / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", SIZE, "white")
    x = (SIZE[0] - resized.width) // 2
    y = (SIZE[1] - resized.height) // 2
    canvas.paste(resized, (x, y))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)
    return {
        "source": str(source.relative_to(REPO)).replace("\\", "/"),
        "output": str(output.relative_to(REPO)).replace("\\", "/"),
        "sourceCanvas": [image.width, image.height],
        "sourceVisibleBbox": list(bbox),
        "outputCanvas": list(SIZE),
        "outputPlacement": [x, y, resized.width, resized.height],
        "scale": scale,
        "operation": "near-white visible bbox, uniform Lanczos scale, centered pure-white padding; no stretch or repaint",
    }


def main() -> None:
    report = {"schemaVersion": 1, "date": "2026-09-02", "units": {}}
    for unit_key, item in UNITS.items():
        unit_root: Path = item["root"]
        references = unit_root / "references"
        sources = {
            "idle": item["idle"],
            "running": unit_root / "keyframes/running-keyframe-v01.png",
            "attacking": unit_root / "keyframes/attacking-keyframe-v01.png",
            "dying": unit_root / "keyframes/attacking-keyframe-v01.png",
        }
        if unit_key == "gunpowder_explosive_lancer":
            sources["charging"] = unit_root / "keyframes/attacking-keyframe-v01.png"
        unit_report = {}
        cavalry = "cavalry" in unit_key or "lancer" in unit_key
        for action, source in sources.items():
            out = references / f"{action}-keyframe-video-safe-16x9.png"
            unit_report[action] = prepare(
                source,
                out,
                width_ratio=0.91 if cavalry else 0.84,
                height_ratio=0.82 if cavalry else 0.84,
            )
        report["units"][unit_key] = unit_report
    (ROOT / "video-reference-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
