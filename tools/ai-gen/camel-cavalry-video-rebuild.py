#!/usr/bin/env python3
"""Build the Camel Cavalry's four animation sheets from its 720p source video.

Source contract (24 fps, 241 frames):
  idle:      f0..f47, sampled every other frame (endpoint excluded)
  walking:   one natural gait cycle, selected after loop analysis
  attacking: f126..f166, visually resampled to 16 frames
  dying:     f176..f206, visually resampled to 16 frames

The runtime integration intentionally contains visual/animation metadata only.
Combat stats and recruitment are outside this asset pass.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
HELPER_PATH = SCRIPT_DIR / "jungle-wizard-video-rebuild.py"
HELPER_SPEC = importlib.util.spec_from_file_location("video_sprite_rebuild", HELPER_PATH)
if HELPER_SPEC is None or HELPER_SPEC.loader is None:
    raise RuntimeError(f"Unable to load sprite helper: {HELPER_PATH}")
helper = importlib.util.module_from_spec(HELPER_SPEC)
sys.modules[HELPER_SPEC.name] = helper
HELPER_SPEC.loader.exec_module(helper)


def normalized_subject(frame: np.ndarray) -> np.ndarray:
    """Return a background-lightened, centered thumbnail for loop comparison."""
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    mask = (gray < 232).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        return cv2.resize(gray, (256, 256), interpolation=cv2.INTER_AREA)
    viable = [
        label for label in range(1, count)
        if int(stats[label, cv2.CC_STAT_AREA]) >= 120
        and int(stats[label, cv2.CC_STAT_TOP]) < frame.shape[0] * 0.8
    ]
    label = max(viable or range(1, count), key=lambda item: int(stats[item, cv2.CC_STAT_AREA]))
    x = int(stats[label, cv2.CC_STAT_LEFT])
    y = int(stats[label, cv2.CC_STAT_TOP])
    w = int(stats[label, cv2.CC_STAT_WIDTH])
    h = int(stats[label, cv2.CC_STAT_HEIGHT])
    pad = 12
    crop = gray[max(0, y - pad):min(gray.shape[0], y + h + pad), max(0, x - pad):min(gray.shape[1], x + w + pad)]
    return cv2.resize(crop, (320, 256), interpolation=cv2.INTER_AREA)


def loop_candidates(frames: list[np.ndarray], start: int, end: int) -> list[tuple[float, int, int]]:
    thumbs = {index: normalized_subject(frames[index]).astype(np.float32) for index in range(start, end + 1)}
    ranked: list[tuple[float, int, int]] = []
    for left in range(start, end + 1):
        for right in range(left + 18, min(end, left + 42) + 1):
            score = float(np.abs(thumbs[left] - thumbs[right]).mean())
            ranked.append((score, left, right))
    return sorted(ranked)[:20]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--target-reference-height", type=int, default=300)
    parser.add_argument("--analyze-loops", action="store_true")
    args = parser.parse_args()

    frames, source_fps = helper.decode_video(args.video)
    if len(frames) != 241 or abs(source_fps - 24.0) > 0.01:
        raise RuntimeError(
            f"Unexpected source contract: {len(frames)} frames at {source_fps:.4f} fps; "
            "expected exactly 241 frames at 24 fps"
        )
    if args.analyze_loops:
        for score, left, right in loop_candidates(frames, 54, 120):
            print(f"walk loop candidate f{left}..f{right - 1}: seam={score:.4f}, span={right - left}")
        return

    # Loop comparison finds the cleanest full gait at f73..f104 (32 source
    # frames). f104 returns to f73's pose and is deliberately excluded.
    specs = [
        helper.ActionSpec("idle", "idle", tuple(range(0, 48, 2)), 12.0, -1, "torso"),
        helper.ActionSpec("walk", "walking", tuple(range(73, 104, 2)), 12.0, -1, "torso"),
        helper.ActionSpec(
            "attack", "attacking", helper.visual_resample_indices(frames, 126, 167, 16),
            12.0, 0, "feet",
        ),
        helper.ActionSpec(
            "dying", "dying", helper.visual_resample_indices(frames, 176, 207, 16),
            12.0, 0, "bbox",
        ),
    ]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model = helper.get_model()
    cache: dict[int, np.ndarray] = {}

    def get_cutout(index: int) -> np.ndarray:
        if index not in cache:
            cache[index] = helper.cutout_rgba(frames[index], model)
            print(f"[camel-cavalry] cutout f{index}", flush=True)
        return cache[index]

    reference = get_cutout(0)
    _, y0, _, y1 = helper.alpha_bbox(reference)
    scale = args.target_reference_height / (y1 - y0 + 1)
    report: dict[str, object] = {
        "source": str(args.video),
        "sourceFrameCount": len(frames),
        "sourceFrameRate": source_fps,
        "targetReferenceHeight": args.target_reference_height,
        "sourceScale": scale,
        "actions": {},
    }
    for action in specs:
        rgba_frames = [get_cutout(index) for index in action.indices]
        anchors = [helper.horizontal_anchor(frame, action.anchor) for frame in rgba_frames]
        cell_w, cell_h = helper.choose_cell(rgba_frames, anchors, scale)
        cells = [
            helper.place_cell(frame, anchor, scale, cell_w, cell_h)
            for frame, anchor in zip(rgba_frames, anchors)
        ]
        sheet = helper.compose_sheet(cells, 8)
        output_name = f"{action.output_stem}.png"
        Image.fromarray(sheet, "RGBA").save(args.out_dir / output_name, optimize=True, compress_level=9)
        helper.save_previews(action.output_stem, cells, action.indices, action.playback_fps, args.out_dir)
        validation = helper.validate_cells(cells, action.repeat)
        report["actions"][action.key] = {
            "output": output_name,
            "sourceIndices": list(action.indices),
            "frameCount": len(action.indices),
            "frameWidth": cell_w,
            "frameHeight": cell_h,
            "cols": 8,
            "rows": math.ceil(len(cells) / 8),
            "frameRate": action.playback_fps,
            "repeat": action.repeat,
            "anchor": action.anchor,
            "validation": validation,
        }
        print(
            f"[camel-cavalry] {action.key}: {len(cells)} frames, cell {cell_w}x{cell_h}, "
            f"validation={validation}", flush=True,
        )

    with (args.out_dir / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
