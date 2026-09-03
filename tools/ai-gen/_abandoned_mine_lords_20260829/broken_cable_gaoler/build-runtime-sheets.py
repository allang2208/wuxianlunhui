#!/usr/bin/env python3
"""Build runtime sheets for the approved Broken Cable Gaoler animations.

Every frame in one action receives the same crop. Horizontal crops stay
symmetrical around the approved source cell centre, vertical crops update the
foot anchor, and visible pixels are copied without resampling. The runtime
class applies one fixed scale per action so the 374/300/260px authored body
standards all render at the same world-space body height.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
SOURCE = ROOT / "candidates"
RUNTIME = REPO / "assets" / "enemies" / "broken_cable_gaoler"
RUNTIME_BODY_HEIGHT = 260

SOURCES = {
    "idle": "broken-cable-gaoler-idle-rife-v01.png",
    "walking": "broken-cable-gaoler-walking-rife-v02.png",
    "chainSweep": "broken-cable-gaoler-chain-sweep-rife-v01.png",
    "hookWinch": "broken-cable-gaoler-hook-winch-rife-v02.png",
    "cageSlam": "broken-cable-gaoler-cage-slam-rife-v01.png",
    "dying": "broken-cable-gaoler-dying-rife-v02.png",
}

OUTPUTS = {
    "idle": "idle.png",
    "walking": "walking.png",
    "chainSweep": "chain_sweep.png",
    "hookWinch": "hook_winch.png",
    "cageSlam": "cage_slam.png",
    "dying": "dying.png",
}

SOURCE_LAYOUTS = {
    "idle": {
        "frameWidth": 640, "frameHeight": 640, "frameCount": 48,
        "columns": 8, "footY": 599, "frameRate": 24, "repeat": -1,
        "authoredBodyHeight": 374,
    },
    "walking": {
        "frameWidth": 640, "frameHeight": 640, "frameCount": 38,
        "columns": 8, "footY": 599, "frameRate": 24, "repeat": -1,
        "authoredBodyHeight": 374,
    },
    "chainSweep": {
        "frameWidth": 1152, "frameHeight": 640, "frameCount": 55,
        "columns": 6, "footY": 599, "frameRate": 12, "repeat": 0,
        "authoredBodyHeight": 300, "contactFrame": 26,
    },
    "hookWinch": {
        "frameWidth": 1536, "frameHeight": 640, "frameCount": 53,
        "columns": 4, "footY": 599, "frameRate": 12, "repeat": 0,
        "authoredBodyHeight": 260, "releaseFrame": 18,
        "returnFrame": 42,
    },
    "cageSlam": {
        "frameWidth": 1024, "frameHeight": 640, "frameCount": 55,
        "columns": 6, "footY": 599, "frameRate": 12, "repeat": 0,
        "authoredBodyHeight": 374, "impactFrame": 38,
    },
    "dying": {
        "frameWidth": 896, "frameHeight": 640, "frameCount": 41,
        "columns": 5, "footY": 599, "frameRate": 12, "repeat": 0,
        "authoredBodyHeight": 374, "corpseSettledFrame": 32,
    },
}


def round_up(value: int, step: int) -> int:
    return int(math.ceil(value / step) * step)


def frame_bbox(alpha: np.ndarray, threshold: int) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("empty animation frame")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def analyze(sheet: Image.Image, layout: dict[str, int], margin: int,
            alignment: int, threshold: int) -> dict[str, int | float]:
    old_w = int(layout["frameWidth"])
    old_h = int(layout["frameHeight"])
    frame_count = int(layout["frameCount"])
    old_cols = int(layout["columns"])
    min_x, min_y, max_x, max_y = old_w, old_h, 0, 0

    for index in range(frame_count):
        col, row = index % old_cols, index // old_cols
        cell = np.asarray(sheet.crop((
            col * old_w, row * old_h,
            (col + 1) * old_w, (row + 1) * old_h,
        )))
        x0, y0, x1, y1 = frame_bbox(cell[..., 3], threshold)
        min_x, min_y = min(min_x, x0), min(min_y, y0)
        max_x, max_y = max(max_x, x1), max(max_y, y1)

    half_extent = max(old_w / 2 - min_x, max_x - old_w / 2)
    new_w = min(old_w, round_up(math.ceil(half_extent + margin) * 2, alignment))
    crop_left = (old_w - new_w) // 2
    crop_top = max(0, (max(0, min_y - margin) // alignment) * alignment)
    crop_bottom = min(old_h, round_up(max_y + margin, alignment))
    new_h = crop_bottom - crop_top
    new_cols = min(old_cols, max(1, 8192 // new_w))
    rows = math.ceil(frame_count / new_cols)

    return {
        "oldFrameWidth": old_w,
        "oldFrameHeight": old_h,
        "oldColumns": old_cols,
        "frameWidth": new_w,
        "frameHeight": new_h,
        "frameCount": frame_count,
        "columns": new_cols,
        "rows": rows,
        "cropLeft": crop_left,
        "cropTop": crop_top,
        "footY": int(layout["footY"]) - crop_top,
        "visibleMinX": min_x,
        "visibleMinY": min_y,
        "visibleMaxX": max_x,
        "visibleMaxY": max_y,
        "sheetWidth": new_w * new_cols,
        "sheetHeight": new_h * rows,
        "authoredBodyHeight": int(layout["authoredBodyHeight"]),
        "bodyScaleTo374": 374 / int(layout["authoredBodyHeight"]),
        "runtimePixelScale": RUNTIME_BODY_HEIGHT / int(layout["authoredBodyHeight"]),
    }


def repack(source: Image.Image, output_path: Path,
           result: dict[str, int | float]) -> None:
    old_w = int(result["oldFrameWidth"])
    old_h = int(result["oldFrameHeight"])
    old_cols = int(result["oldColumns"])
    new_w = int(result["frameWidth"])
    new_h = int(result["frameHeight"])
    new_cols = int(result["columns"])
    frame_count = int(result["frameCount"])
    crop_left = int(result["cropLeft"])
    crop_top = int(result["cropTop"])
    rows = int(result["rows"])
    output = Image.new("RGBA", (new_w * new_cols, new_h * rows), (0, 0, 0, 0))

    for index in range(frame_count):
        old_col, old_row = index % old_cols, index // old_cols
        cell = source.crop((
            old_col * old_w + crop_left,
            old_row * old_h + crop_top,
            old_col * old_w + crop_left + new_w,
            old_row * old_h + crop_top + new_h,
        ))
        new_col, new_row = index % new_cols, index // new_cols
        output.alpha_composite(cell, (new_col * new_w, new_row * new_h))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)


def main() -> None:
    report: dict[str, dict[str, int | float | str]] = {}
    for action, filename in SOURCES.items():
        layout = SOURCE_LAYOUTS[action]
        source_path = SOURCE / filename
        source = Image.open(source_path).convert("RGBA")
        result = analyze(source, layout, margin=16, alignment=32, threshold=10)
        result.update({
            key: value for key, value in layout.items()
            if key not in result and key not in {"frameWidth", "frameHeight", "columns"}
        })
        result["source"] = str(source_path.relative_to(REPO)).replace("\\", "/")
        result["runtime"] = str((RUNTIME / OUTPUTS[action]).relative_to(REPO)).replace("\\", "/")
        repack(source, RUNTIME / OUTPUTS[action], result)
        report[action] = result

    manifest = {
        "characterKey": "brokenCableGaoler",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "runtimeBodyHeight": RUNTIME_BODY_HEIGHT,
        "cropPolicy": "per-action uniform crop; symmetric X; footY-adjusted Y; no visible-pixel resampling",
        "actions": report,
    }
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (ROOT / "runtime-layouts.json").write_text(text, encoding="utf-8")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "spritesheet-manifest.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
