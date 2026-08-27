#!/usr/bin/env python3
"""Build fixed-root transparent sheets from the five accepted Doubao clips."""

from __future__ import annotations

import importlib.util
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
COMMON_PATH = ROOT.parent / "_brown_snake_20260825" / "build-sheets.py"
spec = importlib.util.spec_from_file_location("purple_ancient_sheet_common", COMMON_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load sprite-sheet builder: {COMMON_PATH}")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

common.ROOT = ROOT
common.VIDEO_DIR = ROOT / "video"
common.OUT_DIR = ROOT / "generated" / "raw"
common.PREVIEW_DIR = ROOT / "previews" / "raw"
common.FOOT_Y = 486
common.CELL_HEIGHT = 512
common.EDGE_PAD = 24

TARGET_NEUTRAL_HEIGHT = 360.0
MAGENTA = np.array([255.0, 0.0, 255.0], dtype=np.float32)


def effective_height(alpha: np.ndarray) -> float:
    _x0, y0, _x1, y1 = common.bbox_from_alpha(alpha)
    return float(y1 - y0)


def root_center_x(alpha: np.ndarray) -> float:
    x0, y0, x1, y1 = common.bbox_from_alpha(alpha)
    band_top = y0 + round((y1 - y0) * 0.72)
    ys, xs = np.where(alpha[band_top:y1, x0:x1] > common.ALPHA_THRESHOLD)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    return float(x0 + np.median(xs))


def magenta_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - MAGENTA * (1.0 - a)) / np.maximum(a, 0.04)
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def clean_magenta_rgba(rgba: Image.Image) -> Image.Image:
    arr = np.asarray(rgba, dtype=np.uint8).copy()
    rgb = arr[..., :3]
    alpha = common.largest_hard_alpha(arr[..., 3])
    opaque = alpha > 0
    near_edge = cv2.dilate((~opaque).astype(np.uint8), np.ones((3, 3), np.uint8), 2) > 0
    distance = np.linalg.norm(rgb.astype(np.float32) - MAGENTA, axis=2)
    dominance = (rgb[..., 0].astype(np.float32) + rgb[..., 2]) * 0.5 - rgb[..., 1]
    polluted = opaque & near_edge & ((distance < 115) | (dominance > 48))
    if polluted.any():
        good = opaque & ~polluted
        count_good = cv2.blur(good.astype(np.float32), (7, 7)) * 49.0
        means = np.stack([
            cv2.blur((rgb[..., channel] * good).astype(np.float32), (7, 7)) * 49.0
            for channel in range(3)
        ], axis=-1) / np.maximum(count_good[..., None], 1.0)
        replacement = np.clip(means, 0, 255).astype(np.uint8)
        replacement[count_good < 1] = np.array([54, 43, 36], dtype=np.uint8)
        rgb[polluted] = replacement[polluted]
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def process_frames(model, frames: list[Image.Image], indices: list[int], action: str):
    processed = {}
    for count, index in enumerate(indices, 1):
        image = frames[index].convert("RGB")
        soft_alpha = np.asarray(common.predict_alpha(model, image), dtype=np.uint8)
        hard_alpha = common.largest_hard_alpha(soft_alpha)
        rgb = magenta_decontaminate(np.asarray(image, dtype=np.uint8), soft_alpha)
        processed[index] = (rgb, hard_alpha)
        print(f"[purple-ancient] {action} BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


common.body_thickness = effective_height
common.center_x = root_center_x
common.clean_rgba = clean_magenta_rgba
common.process_frames = process_frames

FRAME_SEQUENCE = list(range(0, 121, 8))
ACTIONS = {
    "idle": {
        "video": common.VIDEO_DIR / "purple-blight-ancient-idle-doubao.mp4",
        "frames": FRAME_SEQUENCE,
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 4,
        "repeat": -1,
        "expectedFrames": 121,
    },
    "spellcast": {
        "video": common.VIDEO_DIR / "purple-blight-ancient-spellcast-doubao.mp4",
        "frames": FRAME_SEQUENCE,
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1700,
        "repeat": 0,
        "expectedFrames": 121,
        "contactSourceFrame": 56,
    },
    "attack": {
        "video": common.VIDEO_DIR / "purple-blight-ancient-attack-doubao.mp4",
        "frames": FRAME_SEQUENCE,
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1500,
        "repeat": 0,
        "expectedFrames": 121,
        "contactSourceFrame": 64,
    },
    "throw": {
        "video": common.VIDEO_DIR / "purple-blight-ancient-throw-doubao.mp4",
        "frames": FRAME_SEQUENCE,
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1600,
        "repeat": 0,
        "expectedFrames": 121,
        "contactSourceFrame": 88,
    },
    "death": {
        "video": common.VIDEO_DIR / "purple-blight-ancient-death-doubao.mp4",
        "frames": FRAME_SEQUENCE,
        "cols": 6,
        # Preserve the source camera transform from the first rooted frame.
        # Grounding every frame to its lowest debris pixel creates a false camera pan.
        "mode": "source_motion",
        "outputFootY": 432,
        "outputCellHeight": 576,
        "duration": 2200,
        "repeat": 0,
        "expectedFrames": 121,
    },
}


def main(only: str | None = None) -> None:
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    common.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    selected = {name: action for name, action in ACTIONS.items() if only is None or name == only}
    decoded = {name: common.decode(action["video"]) for name, action in selected.items()}
    for name, frames in decoded.items():
        expected = ACTIONS[name]["expectedFrames"]
        if len(frames) != expected:
            raise ValueError(f"{name}: expected {expected} frames, got {len(frames)}")
    model = common.get_model()
    processed = {
        name: process_frames(model, decoded[name], action["frames"], name)
        for name, action in selected.items()
    }
    source_heights = {
        name: effective_height(processed[name][action["frames"][0]][1])
        for name, action in selected.items()
    }
    action_scales = {name: TARGET_NEUTRAL_HEIGHT / height for name, height in source_heights.items()}
    manifest_path = ROOT / "raw-sheet-manifest.json"
    if only is not None and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["sourceNeutralHeights"].update(source_heights)
        manifest["actionScales"].update(action_scales)
    else:
        manifest = {
            "sourceContract": "accepted Doubao clips; 1280x720, 121 frames, 24fps",
            "background": "#FF00FF",
            "normalization": "fixed per-action scale from first neutral effective rooted height",
            "targetNeutralHeight": TARGET_NEUTRAL_HEIGHT,
            "sourceNeutralHeights": source_heights,
            "actionScales": action_scales,
            "rootAnchor": "lower root-crown alpha median x",
            "footY": common.FOOT_Y,
            "actions": {},
        }
    for name, action in selected.items():
        default_foot_y = common.FOOT_Y
        default_cell_height = common.CELL_HEIGHT
        common.FOOT_Y = int(action.get("outputFootY", default_foot_y))
        common.CELL_HEIGHT = int(action.get("outputCellHeight", default_cell_height))
        try:
            built = common.build_sheet(name, action, processed[name], action_scales[name])
        finally:
            common.FOOT_Y = default_foot_y
            common.CELL_HEIGHT = default_cell_height
        built["effectiveHeightRange"] = built.pop("bodyThicknessRange")
        if "contactSourceFrame" in action:
            built["contactSourceFrame"] = action["contactSourceFrame"]
            built["contactFrame"] = action["frames"].index(action["contactSourceFrame"])
        manifest["actions"][name] = built
        print(f"[purple-ancient] built {name}: {built}", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(ACTIONS))
    args = parser.parse_args()
    main(args.only)
