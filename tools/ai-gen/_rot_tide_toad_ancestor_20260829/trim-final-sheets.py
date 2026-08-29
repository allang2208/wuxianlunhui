#!/usr/bin/env python3
"""Trim uniform transparent padding from the approved toad animation sheets.

The crop is shared by every frame in one action. Horizontal trimming stays
symmetrical around the original cell centre, so the authored X trajectory does
not move. Vertical trimming updates footY by the removed top padding, preserving
the exact runtime foot anchor without resampling any visible pixels.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
DEFAULT_SOURCE = ROOT / "spritesheets" / "final"
DEFAULT_RUNTIME = REPO / "assets" / "enemies" / "rot_tide_toad_ancestor"
DEFAULT_CONFIG = REPO / "data" / "enemy-config.json"

# Approved RIFE source sheets remain in their original grids. Runtime config
# describes the trimmed outputs, so the source layout is kept explicitly here.
SOURCE_LAYOUTS = {
    "idle": {"frameWidth": 768, "frameHeight": 640, "frameCount": 30, "columns": 8, "footY": 560},
    "moving": {"frameWidth": 1152, "frameHeight": 640, "frameCount": 34, "columns": 8, "footY": 560},
    "attacking": {"frameWidth": 1152, "frameHeight": 640, "frameCount": 43, "columns": 8, "footY": 560},
    "dying": {"frameWidth": 896, "frameHeight": 640, "frameCount": 29, "columns": 8, "footY": 560},
    "tongue_sweep": {"frameWidth": 1280, "frameHeight": 640, "frameCount": 43, "columns": 8, "footY": 560},
    "body_slam": {"frameWidth": 1152, "frameHeight": 640, "frameCount": 53, "columns": 8, "footY": 560},
    "poison_belch": {"frameWidth": 1152, "frameHeight": 640, "frameCount": 41, "columns": 8, "footY": 560},
    "summon_croak": {"frameWidth": 896, "frameHeight": 640, "frameCount": 51, "columns": 8, "footY": 560},
}


def round_up(value: int, step: int) -> int:
    return int(math.ceil(value / step) * step)


def visible_bbox(alpha: np.ndarray, threshold: int) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("animation frame is empty")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def analyze_action(
    sheet_path: Path,
    layout: dict[str, object],
    margin: int,
    alignment: int,
    threshold: int,
) -> dict[str, int]:
    frame_width = int(layout["frameWidth"])
    frame_height = int(layout["frameHeight"])
    frame_count = int(layout["frameCount"])
    columns = int(layout.get("columns", 8))
    foot_y = int(layout["footY"])
    sheet = Image.open(sheet_path).convert("RGBA")

    min_x = frame_width
    min_y = frame_height
    max_x = 0
    max_y = 0
    for index in range(frame_count):
        col = index % columns
        row = index // columns
        cell = np.asarray(sheet.crop((
            col * frame_width,
            row * frame_height,
            (col + 1) * frame_width,
            (row + 1) * frame_height,
        )))
        x0, y0, x1, y1 = visible_bbox(cell[..., 3], threshold)
        min_x = min(min_x, x0)
        min_y = min(min_y, y0)
        max_x = max(max_x, x1)
        max_y = max(max_y, y1)

    half_extent = max(frame_width / 2 - min_x, max_x - frame_width / 2)
    new_width = min(frame_width, round_up(math.ceil(half_extent + margin) * 2, alignment))
    crop_left = (frame_width - new_width) // 2
    crop_top = max(0, (max(0, min_y - margin) // alignment) * alignment)
    crop_bottom = min(frame_height, round_up(max_y + margin, alignment))
    new_height = crop_bottom - crop_top
    new_columns = min(columns, max(1, 8192 // new_width))

    return {
        "oldFrameWidth": frame_width,
        "oldFrameHeight": frame_height,
        "frameWidth": new_width,
        "frameHeight": new_height,
        "frameCount": frame_count,
        "oldColumns": columns,
        "columns": new_columns,
        "cropLeft": crop_left,
        "cropTop": crop_top,
        "footY": foot_y - crop_top,
        "visibleMinX": min_x,
        "visibleMinY": min_y,
        "visibleMaxX": max_x,
        "visibleMaxY": max_y,
    }


def repack(sheet_path: Path, output_path: Path, result: dict[str, int]) -> None:
    source = Image.open(sheet_path).convert("RGBA")
    old_width = result["oldFrameWidth"]
    old_height = result["oldFrameHeight"]
    old_columns = result["oldColumns"]
    new_width = result["frameWidth"]
    new_height = result["frameHeight"]
    new_columns = result["columns"]
    crop_left = result["cropLeft"]
    crop_top = result["cropTop"]
    frame_count = result["frameCount"]
    rows = math.ceil(frame_count / new_columns)
    output = Image.new("RGBA", (new_width * new_columns, new_height * rows), (0, 0, 0, 0))

    for index in range(frame_count):
        old_col = index % old_columns
        old_row = index // old_columns
        cell = source.crop((
            old_col * old_width + crop_left,
            old_row * old_height + crop_top,
            old_col * old_width + crop_left + new_width,
            old_row * old_height + crop_top + new_height,
        ))
        new_col = index % new_columns
        new_row = index // new_columns
        output.alpha_composite(cell, (new_col * new_width, new_row * new_height))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--margin", type=int, default=16)
    parser.add_argument("--alignment", type=int, default=32)
    parser.add_argument("--alpha-threshold", type=int, default=10)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    layouts = config["rotTideToadAncestor"]["textures"]["frameLayouts"]
    report_path = ROOT / "trim-layouts.json"
    report: dict[str, dict[str, int]] = {}
    for action, layout in layouts.items():
        source_path = args.source / f"{action}.png"
        source_layout = SOURCE_LAYOUTS.get(action, layout)
        result = analyze_action(
            source_path,
            source_layout,
            max(0, args.margin),
            max(1, args.alignment),
            max(0, args.alpha_threshold),
        )
        report[action] = result
        if args.apply:
            repack(source_path, args.runtime / f"{action}.png", result)

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(report_path)


if __name__ == "__main__":
    main()
