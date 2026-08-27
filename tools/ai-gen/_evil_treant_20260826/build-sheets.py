#!/usr/bin/env python3
"""Build scale-locked transparent sheets from the accepted evil-treant H3 clips.

The treant is normalized by the effective neutral standing height. Each action
uses one fixed scale, so crouches, arm reach, the fall trajectory, and the final
corpse pose remain natural. Cyan decontamination matches the exact H3 backdrop.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
COMMON_PATH = ROOT.parent / "_brown_snake_20260825" / "build-sheets.py"

spec = importlib.util.spec_from_file_location("evil_treant_sheet_common", COMMON_PATH)
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

TARGET_NEUTRAL_HEIGHT = 430.0
CYAN = np.array([0.0, 255.0, 255.0], dtype=np.float32)


def effective_height(alpha: np.ndarray) -> float:
    _x0, y0, _x1, y1 = common.bbox_from_alpha(alpha)
    return float(y1 - y0)


def torso_center_x(alpha: np.ndarray) -> float:
    """Anchor on the trunk so long arms and branch tips cannot drag the root."""
    x0, y0, x1, y1 = common.bbox_from_alpha(alpha)
    band_top = y0 + round((y1 - y0) * 0.24)
    band_bottom = y0 + round((y1 - y0) * 0.70)
    ys, xs = np.where(alpha[band_top:band_bottom, x0:x1] > common.ALPHA_THRESHOLD)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    return float(x0 + np.median(xs))


def cyan_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - CYAN * (1.0 - a)) / np.maximum(a, 0.04)
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def clean_cyan_rgba(rgba: Image.Image) -> Image.Image:
    arr = np.asarray(rgba, dtype=np.uint8).copy()
    rgb = arr[..., :3]
    alpha = common.largest_hard_alpha(arr[..., 3])
    opaque = alpha > 0
    near_edge = cv2.dilate((~opaque).astype(np.uint8), np.ones((3, 3), np.uint8), 2) > 0
    cyan_distance = np.linalg.norm(rgb.astype(np.float32) - CYAN, axis=2)
    rgb_float = rgb.astype(np.float32)
    cyan_dominance = np.minimum(rgb_float[..., 1], rgb_float[..., 2]) - rgb_float[..., 0]
    polluted = opaque & near_edge & ((cyan_distance < 110) | (cyan_dominance > 28))
    if polluted.any():
        good = opaque & ~polluted
        count_good = cv2.blur(good.astype(np.float32), (7, 7)) * 49.0
        means = np.stack([
            cv2.blur((rgb[..., channel] * good).astype(np.float32), (7, 7)) * 49.0
            for channel in range(3)
        ], axis=-1) / np.maximum(count_good[..., None], 1.0)
        replacement = np.clip(means, 0, 255).astype(np.uint8)
        replacement[count_good < 1] = np.array([52, 47, 38], dtype=np.uint8)
        rgb[polluted] = replacement[polluted]
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def process_frames(model, frames: list[Image.Image], indices: list[int], action: str):
    processed = {}
    for count, index in enumerate(indices, 1):
        image = frames[index].convert("RGB")
        soft_alpha = np.asarray(common.predict_alpha(model, image), dtype=np.uint8)
        hard_alpha = common.largest_hard_alpha(soft_alpha)
        rgb = cyan_decontaminate(np.asarray(image, dtype=np.uint8), soft_alpha)
        processed[index] = (rgb, hard_alpha)
        print(
            f"[evil-treant] {action} BiRefNet {count}/{len(indices)} frame={index}",
            flush=True,
        )
    return processed


common.body_thickness = effective_height
common.center_x = torso_center_x
common.clean_rgba = clean_cyan_rgba
common.process_frames = process_frames


ACTIONS = {
    "idle": {
        "video": common.VIDEO_DIR / "evil-treant-idle-h3.mp4",
        "frames": list(range(0, 120, 8)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 6,
        "repeat": -1,
        "expectedFrames": 124,
    },
    "walking": {
        "video": common.VIDEO_DIR / "evil-treant-walking-h3.mp4",
        "frames": list(range(0, 120, 6)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 8,
        "repeat": -1,
        "expectedFrames": 124,
    },
    "attacking": {
        "video": common.VIDEO_DIR / "evil-treant-attacking-h3.mp4",
        "frames": [0, 8, 16, 24, 32, 40, 48, 54, 58, 62, 70, 82, 94, 100, 106, 112, 118, 123],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1500,
        "repeat": 0,
        "expectedFrames": 124,
        "contactSourceFrame": 58,
    },
    "dying": {
        "video": common.VIDEO_DIR / "evil-treant-dying-h3.mp4",
        "frames": [0, 8, 16, 24, 28, 32, 36, 40, 44, 48, 52, 56, 64, 123],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
        "expectedFrames": 124,
    },
}


def main() -> None:
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    common.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: common.decode(action["video"]) for name, action in ACTIONS.items()}
    for name, frames in decoded.items():
        expected = ACTIONS[name]["expectedFrames"]
        if len(frames) != expected:
            raise ValueError(f"{name}: expected {expected} frames, got {len(frames)}")

    model = common.get_model()
    processed = {
        name: process_frames(model, decoded[name], action["frames"], name)
        for name, action in ACTIONS.items()
    }
    source_heights = {
        name: effective_height(processed[name][action["frames"][0]][1])
        for name, action in ACTIONS.items()
    }
    action_scales = {
        name: TARGET_NEUTRAL_HEIGHT / height
        for name, height in source_heights.items()
    }

    manifest = {
        "sourceContract": "accepted MiniMax H3 clips only; 1024x576, 124 frames, 16 steps",
        "background": "#00FFFF",
        "normalization": "one fixed per-action scale from first neutral effective standing height",
        "targetNeutralHeight": TARGET_NEUTRAL_HEIGHT,
        "sourceNeutralHeights": source_heights,
        "actionScales": action_scales,
        "rootAnchor": "trunk-band alpha median x; arms and crown tips excluded",
        "footY": common.FOOT_Y,
        "stateScaleContract": "no per-frame scaling; source attack/fall trajectories remain natural",
        "actions": {},
    }
    for name, action in ACTIONS.items():
        built = common.build_sheet(name, action, processed[name], action_scales[name])
        built["effectiveHeightRange"] = built.pop("bodyThicknessRange")
        if "contactSourceFrame" in action:
            built["contactSourceFrame"] = action["contactSourceFrame"]
            built["contactFrame"] = action["frames"].index(action["contactSourceFrame"])
        manifest["actions"][name] = built
        print(f"[evil-treant] built {name}: {built}", flush=True)

    path = ROOT / "raw-sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[evil-treant] manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
