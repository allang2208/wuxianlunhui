#!/usr/bin/env python3
"""Measure the v06 semi-coiled walking candidate without modifying runtime assets."""

from __future__ import annotations

import importlib.util
import json
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE_BUILDER = ROOT / "build-sheets.py"
VIDEO = ROOT / "video" / "brown-snake-walking-h3-v06-semi-coiled-crawl-loop.mp4"
REPORT = ROOT / "reports" / "walking-v06-candidate.json"
SAMPLE_FRAMES = [0, 5, 11, 16, 21, 27, 32, 37, 43, 48, 53, 59,
                 64, 70, 75, 80, 86, 91, 96, 102, 107, 112, 118, 123]
TARGET_BODY_THICKNESS = 88.0


def load_builder():
    spec = importlib.util.spec_from_file_location("brown_snake_base_builder", BASE_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {BASE_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    builder = load_builder()
    frames = builder.decode(VIDEO)
    if len(frames) != 124:
        raise ValueError(f"expected 124 frames, got {len(frames)}")

    model = builder.get_model()
    processed = builder.process_frames(model, frames, SAMPLE_FRAMES, "walking-v06-analysis")
    source_thicknesses = [
        round(builder.body_thickness(processed[index][1]), 2)
        for index in SAMPLE_FRAMES
    ]
    source_median = float(statistics.median(source_thicknesses))
    scale = TARGET_BODY_THICKNESS / source_median
    normalized = [round(value * scale, 2) for value in source_thicknesses]
    widths = []
    heights = []
    for index in SAMPLE_FRAMES:
        x0, y0, x1, y1 = builder.bbox_from_alpha(processed[index][1])
        widths.append(x1 - x0)
        heights.append(y1 - y0)

    report = {
        "asset": "brown_snake",
        "action": "walking",
        "candidate": "v06-semi-coiled-crawl-loop",
        "runtimeIntegrated": False,
        "sourceVideo": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "sampleFrames": SAMPLE_FRAMES,
        "normalization": "fixed scale from median local body thickness; pose bbox excluded",
        "targetBodyThickness": TARGET_BODY_THICKNESS,
        "sourceBodyThicknesses": source_thicknesses,
        "sourceBodyThicknessRange": [min(source_thicknesses), max(source_thicknesses)],
        "sourceMedianBodyThickness": source_median,
        "candidateScale": scale,
        "normalizedBodyThicknesses": normalized,
        "normalizedBodyThicknessRange": [min(normalized), max(normalized)],
        "sourceVisibleWidthRange": [min(widths), max(widths)],
        "sourceVisibleHeightRange": [min(heights), max(heights)],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
