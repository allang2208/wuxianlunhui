#!/usr/bin/env python3
"""Build lossless runtime sheets for the Sealed-Shaft Rock Wraith."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
RUNTIME = REPO / "assets" / "enemies" / "sealed_shaft_rock_wraith"
RUNTIME_BODY_HEIGHT = 260
AUTHORED_BODY_HEIGHT = 460
SOURCE_FOOT_Y = 650

SOURCES = {
    name: ROOT / "sheets" / "interpolated" / f"{name}.png"
    for name in ("idle", "walking", "crystalArmSmash", "borequake", "drillRush", "dying")
}
OUTPUTS = {
    "idle": "idle.png",
    "walking": "walking.png",
    "crystalArmSmash": "crystal_arm_smash.png",
    "borequake": "borequake.png",
    "drillRush": "drill_rush.png",
    "dying": "dying.png",
}
SOURCE_LAYOUTS = {
    "idle": {"oldFrameWidth": 640, "oldFrameHeight": 672, "oldColumns": 8, "frameCount": 50, "frameRate": 12, "repeat": -1},
    "walking": {"oldFrameWidth": 640, "oldFrameHeight": 672, "oldColumns": 8, "frameCount": 50, "frameRate": 12, "repeat": -1},
    "crystalArmSmash": {"oldFrameWidth": 640, "oldFrameHeight": 672, "oldColumns": 8, "frameCount": 61, "duration": 5083, "contactFrame": 30, "repeat": 0},
    "borequake": {"oldFrameWidth": 640, "oldFrameHeight": 672, "oldColumns": 8, "frameCount": 61, "duration": 5083, "releaseFrame": 24, "repeat": 0},
    "drillRush": {"oldFrameWidth": 640, "oldFrameHeight": 672, "oldColumns": 8, "frameCount": 61, "duration": 5083, "chargeStartFrame": 18, "chargeEndFrame": 31, "repeat": 0},
    "dying": {"oldFrameWidth": 1280, "oldFrameHeight": 672, "oldColumns": 6, "frameCount": 41, "duration": 3417, "corpseSettledFrame": 36, "repeat": 0},
}


def round_up(value: int, step: int) -> int:
    return int(math.ceil(value / step) * step)


def bbox(alpha: np.ndarray, threshold: int = 10) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("empty runtime frame")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def analyze(source: Image.Image, layout: dict[str, int]) -> dict[str, int | float]:
    old_w = int(layout["oldFrameWidth"])
    old_h = int(layout["oldFrameHeight"])
    old_cols = int(layout["oldColumns"])
    frame_count = int(layout["frameCount"])
    min_x, min_y, max_x, max_y = old_w, old_h, 0, 0
    for index in range(frame_count):
        col, row = index % old_cols, index // old_cols
        cell = np.asarray(source.crop((
            col * old_w, row * old_h,
            (col + 1) * old_w, (row + 1) * old_h,
        )))
        x0, y0, x1, y1 = bbox(cell[..., 3])
        min_x, min_y = min(min_x, x0), min(min_y, y0)
        max_x, max_y = max(max_x, x1), max(max_y, y1)

    margin = 16
    alignment = 32
    half = max(old_w / 2 - min_x, max_x - old_w / 2)
    new_w = min(old_w, round_up(math.ceil(half + margin) * 2, alignment))
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
        "footY": SOURCE_FOOT_Y - crop_top,
        "visibleMinX": min_x,
        "visibleMinY": min_y,
        "visibleMaxX": max_x,
        "visibleMaxY": max_y,
        "sheetWidth": new_w * new_cols,
        "sheetHeight": new_h * rows,
        "authoredBodyHeight": AUTHORED_BODY_HEIGHT,
        "runtimePixelScale": RUNTIME_BODY_HEIGHT / AUTHORED_BODY_HEIGHT,
    }


def repack(source: Image.Image, output_path: Path, info: dict[str, int | float]) -> None:
    old_w = int(info["oldFrameWidth"])
    old_h = int(info["oldFrameHeight"])
    old_cols = int(info["oldColumns"])
    new_w = int(info["frameWidth"])
    new_h = int(info["frameHeight"])
    new_cols = int(info["columns"])
    frame_count = int(info["frameCount"])
    crop_left = int(info["cropLeft"])
    crop_top = int(info["cropTop"])
    rows = int(info["rows"])
    output = Image.new("RGBA", (new_w * new_cols, new_h * rows), (0, 0, 0, 0))
    for index in range(frame_count):
        old_col, old_row = index % old_cols, index // old_cols
        cell = source.crop((
            old_col * old_w + crop_left,
            old_row * old_h + crop_top,
            old_col * old_w + crop_left + new_w,
            old_row * old_h + crop_top + new_h,
        ))
        col, row = index % new_cols, index // new_cols
        output.alpha_composite(cell, (col * new_w, row * new_h))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path, optimize=True)


def main() -> None:
    actions: dict[str, dict[str, int | float | str]] = {}
    for action, source_path in SOURCES.items():
        source = Image.open(source_path).convert("RGBA")
        info = analyze(source, SOURCE_LAYOUTS[action])
        info.update({
            key: value for key, value in SOURCE_LAYOUTS[action].items()
            if key not in info and key not in {"oldColumns"}
        })
        info["source"] = str(source_path.relative_to(REPO)).replace("\\", "/")
        output_path = RUNTIME / OUTPUTS[action]
        info["runtime"] = str(output_path.relative_to(REPO)).replace("\\", "/")
        repack(source, output_path, info)
        actions[action] = info

    manifest = {
        "characterKey": "sealedShaftRockWraith",
        "assetOnly": False,
        "runtimeIntegrationActive": True,
        "runtimeBodyHeight": RUNTIME_BODY_HEIGHT,
        "cropPolicy": "per-action uniform crop; symmetric X; footY-adjusted Y; no visible-pixel resampling",
        "actions": actions,
    }
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (ROOT / "runtime-layouts.json").write_text(text, encoding="utf-8")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    (RUNTIME / "spritesheet-manifest.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
