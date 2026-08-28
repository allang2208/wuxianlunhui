#!/usr/bin/env python3
"""Build accepted source sheets for the mounted scout-rifle skirmisher."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
PAIR_PATH = REPO / "tools" / "ai-gen" / "_hamster_cavalry_pair_20260827" / "build-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("scout_skirmisher_pair_helper", PAIR_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot import mounted-unit helper: {PAIR_PATH}")
PAIR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PAIR
SPEC.loader.exec_module(PAIR)

BASE = PAIR.HELPER.BASE
FRAME_HEIGHT = 512
FEET_Y = 375
TARGET_MOUNTED_BODY_HEIGHT = 236
COLS = 8
MARGIN = 16


@dataclass(frozen=True)
class Action:
    key: str
    video_name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def alpha_bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    return BASE.alpha_bbox(rgba)


def body_height(rgba: np.ndarray) -> int:
    _, y0, _, y1 = PAIR.opened_mounted_body_bbox(rgba)
    return y1 - y0 + 1


def choose_width(
    frames: list[np.ndarray], scale: float, action: Action
) -> tuple[int, float | None]:
    if action.horizontal_mode == "center-body":
        half_span = 0.0
        for rgba in frames:
            x0, _, x1, _ = alpha_bbox(rgba)
            anchor = PAIR.body_anchor_x(rgba)
            half_span = max(half_span, (anchor - x0) * scale, (x1 + 1 - anchor) * scale)
        return PAIR.round_width(half_span * 2 + MARGIN * 2), None

    reference_anchor = PAIR.body_anchor_x(frames[0])
    left = min((alpha_bbox(rgba)[0] - reference_anchor) * scale for rgba in frames)
    right = max((alpha_bbox(rgba)[2] + 1 - reference_anchor) * scale for rgba in frames)
    return PAIR.round_width(max(abs(left), abs(right)) * 2 + MARGIN * 2), reference_anchor


def place_cell(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    action: Action,
    reference_x: float | None,
    reference_body_bottom: int | None,
) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    _, _, _, body_y1 = PAIR.opened_mounted_body_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    ).copy()
    resized[resized[..., 3] == 0, :3] = 0

    if action.horizontal_mode == "center-body":
        anchor = PAIR.body_anchor_x(rgba)
        offset_x = round(frame_width / 2 - (anchor - x0) * scale)
    else:
        if reference_x is None:
            raise RuntimeError("preserve-source attack needs a fixed horizontal anchor")
        offset_x = round(frame_width / 2 + (x0 - reference_x) * scale)

    if action.vertical_mode == "body-feet":
        offset_y = round(FEET_Y - (body_y1 - y0) * scale)
    elif action.vertical_mode == "preserve-source":
        if reference_body_bottom is None:
            raise RuntimeError("preserve-source attack needs a fixed vertical anchor")
        offset_y = round(FEET_Y + (y0 - reference_body_bottom) * scale)
    else:
        raise ValueError(action.vertical_mode)

    if (
        offset_x < MARGIN
        or offset_y < MARGIN
        or offset_x + width > frame_width - MARGIN
        or offset_y + height > FRAME_HEIGHT - MARGIN
    ):
        raise RuntimeError(
            f"{action.key} clips margin: {width}x{height} at {offset_x},{offset_y} "
            f"inside {frame_width}x{FRAME_HEIGHT}"
        )
    cell = np.zeros((FRAME_HEIGHT, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return PAIR.clean_alpha(cell)


def metrics(cells: list[np.ndarray]) -> dict[str, object]:
    heights: list[int] = []
    bottoms: list[int] = []
    for cell in cells:
        _, y0, _, y1 = PAIR.opened_mounted_body_bbox(cell, PAIR.BODY_OPEN_KERNEL_OUTPUT)
        heights.append(y1 - y0 + 1)
        bottoms.append(y1)
    return {
        "effectiveBodyHeightMin": min(heights),
        "effectiveBodyHeightMedian": float(np.median(heights)),
        "effectiveBodyHeightMax": max(heights),
        "effectiveBodyBottomMin": min(bottoms),
        "effectiveBodyBottomMax": max(bottoms),
    }


def restore_standing_muzzle_flash(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Restore only the warm f60 flash pixels that BiRefNet drops on white."""
    height, width = rgb.shape[:2]
    red = rgb[..., 0].astype(np.int16)
    green = rgb[..., 1].astype(np.int16)
    blue = rgb[..., 2].astype(np.int16)
    roi = np.zeros((height, width), np.uint8)
    roi[round(height * 0.22):round(height * 0.43), round(width * 0.52):round(width * 0.75)] = 1
    warm = (
        (roi > 0)
        & (red > 140)
        & (green > 65)
        & ((red - blue) > 40)
        & ((green - blue) > 10)
        & (rgba[..., 3] < 64)
    ).astype(np.uint8)
    warm = cv2.morphologyEx(warm, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count = int(np.count_nonzero(warm))
    if count == 0:
        raise RuntimeError("standing attack f60 warm muzzle flash mask is empty")

    restored = rgba.copy()
    strength = np.clip((red - blue - 20) * 5, 96, 255).astype(np.uint8)
    restored[warm > 0, :3] = rgb[warm > 0]
    restored[..., 3][warm > 0] = np.maximum(
        restored[..., 3][warm > 0], strength[warm > 0]
    )
    return PAIR.clean_alpha(restored), count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only",
        choices=("idle", "moving", "moving_attacking", "standing_attacking", "dying"),
    )
    args = parser.parse_args()
    videos = {
        "idle": BASE.decode_video(ROOT / "videos" / "idle-user-1.mp4"),
        "moving": BASE.decode_video(ROOT / "videos" / "moving-attacking-h3-v02.mp4"),
        "moving_attacking": BASE.decode_video(ROOT / "videos" / "moving-attacking-h3-v02.mp4"),
        "standing_attacking": BASE.decode_video(ROOT / "videos" / "standing-attacking-h3-v03.mp4"),
        "dying": BASE.decode_video(ROOT / "videos" / "dying-h3-v01.mp4"),
    }
    idle_indices = BASE.visual_resample_indices(videos["idle"][0], 0, 49, 13)
    actions = (
        Action("idle", "idle-user-1.mp4", idle_indices, 8.0, -1, "center-body", "body-feet"),
        Action(
            "moving",
            "moving-attacking-h3-v02.mp4",
            tuple(range(92, 112, 2)),
            12.0,
            -1,
            "preserve-source",
            "preserve-source",
        ),
        Action(
            "moving_attacking",
            "moving-attacking-h3-v02.mp4",
            tuple(range(32, 63, 2)),
            12.0,
            0,
            "preserve-source",
            "preserve-source",
        ),
        Action(
            "standing_attacking",
            "standing-attacking-h3-v03.mp4",
            tuple(range(52, 81, 2)),
            12.0,
            0,
            "preserve-source",
            "preserve-source",
        ),
        Action(
            "dying",
            "dying-h3-v01.mp4",
            tuple(range(24, 73, 2)),
            12.0,
            0,
            "preserve-source",
            "preserve-source",
        ),
    )
    selected_actions = tuple(action for action in actions if not args.only or action.key == args.only)

    frame_root = ROOT / "frames" / "birefnet-source"
    source_root = ROOT / "source-sheets-pre-interpolation"
    preview_root = ROOT / "previews" / "source-sheets"
    model = None
    cache: dict[tuple[str, int], np.ndarray] = {}

    for action in selected_actions:
        frame_dir = frame_root / action.key
        frame_dir.mkdir(parents=True, exist_ok=True)
        for index in action.indices:
            frame_path = frame_dir / f"source-{index:03d}.png"
            if frame_path.exists():
                rgba = np.asarray(Image.open(frame_path).convert("RGBA")).copy()
            else:
                if model is None:
                    model = BASE.get_model()
                rgba = PAIR.clean_alpha(BASE.cutout_rgba(videos[action.key][0][index], model))
                Image.fromarray(rgba, "RGBA").save(frame_path)
            if action.key == "standing_attacking" and index == 60:
                rgba, flash_pixels = restore_standing_muzzle_flash(
                    videos[action.key][0][index], rgba
                )
                Image.fromarray(rgba, "RGBA").save(frame_path)
                print(
                    f"[scout-skirmisher] standing_attacking f60 restored warm flash "
                    f"pixels={flash_pixels}",
                    flush=True,
                )
            cache[(action.key, index)] = rgba
            print(f"[scout-skirmisher] {action.key} BiRefNet f{index}", flush=True)

    report_path = ROOT / "source-sheet-report.json"
    previous_actions: dict[str, object] = {}
    if args.only and report_path.exists():
        previous_actions = json.loads(report_path.read_text(encoding="utf-8")).get("actions", {})
    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "scope": sorted(set(previous_actions) | {action.key for action in selected_actions}),
        "bodyScaleReference": "hamster mounted cavalry output standard",
        "targetMountedBodyHeight": TARGET_MOUNTED_BODY_HEIGHT,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "scalePolicy": "each differently framed source uses one fixed per-action scale to reach the same mounted-body output height; no per-frame resizing",
        "attackMotionPolicy": "preserve the source rider/cat translation and gait on both axes",
        "standingAttackMuzzlePolicy": "restore only warm non-subject pixels in the source f60 muzzle ROI; detached gray smoke remains excluded",
        "attackSound": "assets/companions/hamster_musketeer/fire.mp3",
        "actions": previous_actions,
    }

    for action in selected_actions:
        rgba_frames = [cache[(action.key, index)] for index in action.indices]
        measured_body_heights = [body_height(rgba) for rgba in rgba_frames]
        source_body_height = float(
            measured_body_heights[0]
            if action.key == "dying"
            else np.median(measured_body_heights)
        )
        fixed_scale = TARGET_MOUNTED_BODY_HEIGHT / source_body_height
        frame_width, reference_x = choose_width(rgba_frames, fixed_scale, action)
        if frame_width > 1024:
            raise RuntimeError(f"{action.key} requires unsupported frame width {frame_width}")
        reference_bottom = PAIR.opened_mounted_body_bbox(rgba_frames[0])[3]
        cells = [
            place_cell(rgba, fixed_scale, frame_width, action, reference_x, reference_bottom)
            for rgba in rgba_frames
        ]

        source_root.mkdir(parents=True, exist_ok=True)
        Image.fromarray(PAIR.compose(cells), "RGBA").save(
            source_root / f"{action.key}.png", optimize=True, compress_level=9
        )
        PAIR.save_previews(
            "scout_rifle_skirmisher",
            PAIR.Action(
                action.key,
                action.indices,
                action.frame_rate,
                action.repeat,
                action.horizontal_mode,
                action.vertical_mode,
            ),
            cells,
            preview_root,
        )
        validation = BASE.validate_cells(cells, action.repeat)
        validation.update(metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][action.key] = {
            "source": f"videos/{action.video_name}",
            "sourceFrameRate": videos[action.key][1],
            "sourceIndices": list(action.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "sourceSheetFrameRate": action.frame_rate,
            "repeat": action.repeat,
            "fixedSourceScale": fixed_scale,
            "sourceMountedBodyHeightMedian": source_body_height,
            "sourceScaleBasis": (
                "first standing key frame; fallen height intentionally preserved"
                if action.key == "dying"
                else "median effective mounted body height"
            ),
            "expectedRifeFrameCount": len(cells) * 2 if action.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": action.frame_rate * 2,
            "horizontalMode": action.horizontal_mode,
            "verticalMode": action.vertical_mode,
            "validation": validation,
        }

    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
