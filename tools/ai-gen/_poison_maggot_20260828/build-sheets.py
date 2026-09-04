#!/usr/bin/env python3
"""Build transparent, old-scale poison-maggot sheets from accepted Doubao clips."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
COMMON_PATH = REPO / "tools" / "ai-gen" / "_brown_snake_20260825" / "build-sheets.py"

spec = importlib.util.spec_from_file_location("poison_maggot_sheet_common", COMMON_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load common sheet builder: {COMMON_PATH}")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

common.ROOT = ROOT
common.VIDEO_DIR = ROOT / "videos"
common.OUT_DIR = ROOT / "generated" / "raw"
common.PREVIEW_DIR = ROOT / "previews" / "raw"
common.FOOT_Y = 357
common.CELL_HEIGHT = 512
common.EDGE_PAD = 18

TARGET_NEUTRAL_WIDTH = 410.0
BLUE = np.array([0.0, 0.0, 255.0], dtype=np.float32)


ACTIONS = {
    "idle": {
        "video": common.VIDEO_DIR / "idle.mp4",
        "frames": list(range(0, 120, 10)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 4.0,
        "repeat": -1,
    },
    "walking": {
        "video": common.VIDEO_DIR / "walk.mp4",
        "frames": list(range(0, 120, 6)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 8.0,
        "repeat": -1,
    },
    "spitting": {
        "video": common.VIDEO_DIR / "spit.mp4",
        "frames": [0, 12, 24, 32, 38, 44, 50, 54, 58, 64, 72, 80, 88, 94, 100, 108, 120],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 3000,
        "repeat": 0,
        "releaseSourceFrame": 54,
        "releaseStopSourceFrame": 94,
    },
    "dying": {
        "video": common.VIDEO_DIR / "death.mp4",
        "frames": [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 84, 96, 108, 120],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
    },
}


def dense_body_window(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """Find the thick connected body while excluding the generated poison beam."""
    binary = (alpha >= common.HARD_ALPHA).astype(np.uint8)
    opened = cv2.morphologyEx(
        binary,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)),
    )
    count, labels = cv2.connectedComponents(opened)
    if count <= 1:
        return common.bbox_from_alpha(alpha)
    keep = max(range(1, count), key=lambda label: int((labels == label).sum()))
    ys, xs = np.where(labels == keep)
    height, width = alpha.shape
    return (
        max(0, int(xs.min()) - 42),
        max(0, int(ys.min()) - 96),
        min(width, int(xs.max()) + 43),
        min(height, int(ys.max()) + 116),
    )


def blue_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - BLUE * (1.0 - a)) / np.maximum(a, 0.04)
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def clean_blue_rgba(rgba: Image.Image) -> Image.Image:
    arr = np.asarray(rgba, dtype=np.uint8).copy()
    rgb = arr[..., :3]
    alpha = common.largest_hard_alpha(arr[..., 3])
    opaque = alpha > 0
    near_edge = cv2.dilate((~opaque).astype(np.uint8), np.ones((3, 3), np.uint8), 2) > 0
    blue_excess = rgb[..., 2].astype(np.int16) - np.maximum(rgb[..., 0], rgb[..., 1]).astype(np.int16)
    polluted = opaque & near_edge & (blue_excess > 38)
    if polluted.any():
        good = opaque & ~polluted
        count_good = cv2.blur(good.astype(np.float32), (7, 7)) * 49.0
        means = np.stack([
            cv2.blur((rgb[..., channel] * good).astype(np.float32), (7, 7)) * 49.0
            for channel in range(3)
        ], axis=-1) / np.maximum(count_good[..., None], 1.0)
        replacement = np.clip(means, 0, 255).astype(np.uint8)
        replacement[count_good < 1] = np.array([54, 45, 30], dtype=np.uint8)
        rgb[polluted] = replacement[polluted]
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def process_frames(model, frames: list[Image.Image], indices: list[int], action: str):
    processed = {}
    for count, index in enumerate(indices, 1):
        image = frames[index].convert("RGB")
        rgb = np.asarray(image, dtype=np.uint8)
        soft_alpha = np.asarray(common.predict_alpha(model, image), dtype=np.uint8)
        hard_alpha = common.largest_hard_alpha(soft_alpha)
        if action == "spitting":
            x0, y0, x1, y1 = dense_body_window(soft_alpha)
            window = np.zeros_like(hard_alpha)
            window[y0:y1, x0:x1] = 255
            hard_alpha = common.largest_hard_alpha(np.minimum(hard_alpha, window))
            # Seedance ignored the no-projectile prompt for the first release frame.
            # Remove its blue/purple jet pixels here; Phaser supplies the formal green
            # cone at runtime, while the body/head casting motion stays untouched.
            blue_purple_jet = (
                (rgb[..., 2].astype(np.int16) > np.maximum(rgb[..., 0], rgb[..., 1]).astype(np.int16) + 18)
                & (rgb[..., 2] > 72)
            )
            hard_alpha[blue_purple_jet] = 0
            hard_alpha = common.largest_hard_alpha(hard_alpha)
        foreground = blue_decontaminate(rgb, soft_alpha)
        foreground[hard_alpha == 0] = 0
        processed[index] = (foreground, hard_alpha)
        print(f"[poison-maggot] {action} BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


def effective_width(alpha: np.ndarray) -> float:
    x0, _y0, x1, _y1 = common.bbox_from_alpha(alpha)
    return float(x1 - x0)


common.process_frames = process_frames
common.clean_rgba = clean_blue_rgba
common.body_thickness = effective_width


def main() -> None:
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    common.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: common.decode(action["video"]) for name, action in ACTIONS.items()}
    for name, frames in decoded.items():
        if len(frames) != 121:
            raise ValueError(f"{name}: expected 121 frames, got {len(frames)}")

    model = common.get_model()
    processed = {
        name: process_frames(model, decoded[name], action["frames"], name)
        for name, action in ACTIONS.items()
    }
    source_widths = {
        name: effective_width(processed[name][action["frames"][0]][1])
        for name, action in ACTIONS.items()
    }
    action_scales = {
        name: TARGET_NEUTRAL_WIDTH / width
        for name, width in source_widths.items()
    }

    manifest = {
        "asset": "poison-maggot",
        "sourceContract": "accepted Doubao Seedance 2.0 Mini clips; 1344x768, 121 frames, 24fps",
        "background": "#0000FF",
        "cutout": "BiRefNet-general plus dense-body window for generated spit-beam exclusion",
        "normalization": "one fixed per-action scale from first neutral effective body width",
        "targetNeutralWidth": TARGET_NEUTRAL_WIDTH,
        "legacyNeutralBBox": [49, 167, 459, 357],
        "footY": common.FOOT_Y,
        "stateScaleContract": "no per-frame scaling; source posture and collapse trajectory remain natural",
        "actions": {},
    }
    for name, action in ACTIONS.items():
        built = common.build_sheet(name, action, processed[name], action_scales[name])
        built["effectiveWidthRange"] = built.pop("bodyThicknessRange")
        if "releaseSourceFrame" in action:
            built["releaseSourceFrame"] = action["releaseSourceFrame"]
            built["releaseFrame"] = action["frames"].index(action["releaseSourceFrame"])
            built["releaseStopSourceFrame"] = action["releaseStopSourceFrame"]
            built["releaseStopFrame"] = action["frames"].index(action["releaseStopSourceFrame"])
        manifest["actions"][name] = built
        print(f"[poison-maggot] built {name}: {built}", flush=True)

    path = ROOT / "raw-sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[poison-maggot] raw manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
