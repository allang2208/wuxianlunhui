#!/usr/bin/env python3
"""Build the accepted raised-coil brown-snake attack source sheet."""

from __future__ import annotations

import importlib.util
import json
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE_BUILDER = ROOT / "build-sheets.py"
VIDEO = ROOT / "video" / "brown-snake-attacking-h3-v02-cobra-motion.mp4"

# Full raised-coil attack, with denser sampling around the forward bite.
SOURCE_FRAMES = [
    0, 8, 16, 24, 32, 40, 46, 50, 54, 58, 62,
    66, 70, 74, 80, 88, 96, 104, 112, 120, 123,
]
TARGET_MEDIAN_VISIBLE_WIDTH = 540.0


def load_builder():
    spec = importlib.util.spec_from_file_location("brown_snake_base_builder", BASE_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {BASE_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    builder = load_builder()
    builder.OUT_DIR = ROOT / "generated" / "source-pre-rife"
    builder.PREVIEW_DIR = ROOT / "previews" / "source"
    builder.OUT_DIR.mkdir(parents=True, exist_ok=True)
    builder.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    frames = builder.decode(VIDEO)
    if len(frames) != 124:
        raise ValueError(f"expected 124 frames, got {len(frames)}")

    action = {
        "video": VIDEO,
        "frames": SOURCE_FRAMES,
        "cols": 8,
        "mode": "source_motion_grounded",
        "duration": 900,
        "repeat": 0,
    }
    model = builder.get_model()
    processed = builder.process_frames(model, frames, SOURCE_FRAMES, "attacking-v02")
    # A closed coil encloses a broad opaque region, so a distance transform
    # overstates local body thickness. Match the already accepted attack-size
    # baseline instead: the previous attack's median visible width was 540 px.
    source_widths = []
    for index in SOURCE_FRAMES:
        x0, _y0, x1, _y1 = builder.bbox_from_alpha(processed[index][1])
        source_widths.append(x1 - x0)
    source_median_width = float(statistics.median(source_widths))
    scale = TARGET_MEDIAN_VISIBLE_WIDTH / source_median_width
    result = builder.build_sheet("attacking-v02-source", action, processed, scale)
    # The source-clock GIF is a disposable review cache, not a formal archive input.
    result.pop("preview", None)
    report = {
        "asset": "brown_snake",
        "action": "attacking",
        "candidate": "v02-cobra-motion",
        "accepted": True,
        "sourceVideo": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "builder": BASE_BUILDER.name,
        "normalization": "fixed action scale from accepted attack median visible width",
        "targetMedianVisibleWidth": TARGET_MEDIAN_VISIBLE_WIDTH,
        "sourceVisibleWidths": source_widths,
        "sourceMedianVisibleWidth": source_median_width,
        "actionScale": scale,
        "actionData": result,
    }
    output = ROOT / "reports" / "attacking-v02-source.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
