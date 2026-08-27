#!/usr/bin/env python3
"""Build the V2 treant death sheet while preserving separated wood chunks."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
BASE_PATH = ROOT / "build-sheets.py"

spec = importlib.util.spec_from_file_location("evil_treant_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load base treant builder: {BASE_PATH}")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

common = base.common
common.OUT_DIR = ROOT / "generated" / "v02" / "raw"
common.PREVIEW_DIR = ROOT / "previews" / "v02" / "raw"

VIDEO = ROOT / "video" / "evil-treant-dying-fracture-v02-h3.mp4"
MANIFEST = ROOT / "dying-fracture-v02-raw-manifest.json"
MIN_COMPONENT_AREA = 24

ACTION = {
    "video": VIDEO,
    "frames": [0, 32, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 92, 123],
    "cols": 8,
    "mode": "source_motion_grounded",
    "duration": 1800,
    "repeat": 0,
    "expectedFrames": 124,
}


def keep_wood_components(alpha: np.ndarray) -> np.ndarray:
    """Keep every substantial disconnected chunk instead of only the largest body."""
    hard = (alpha >= common.HARD_ALPHA).astype(np.uint8)
    count, labels, stats, _centroids = cv2.connectedComponentsWithStats(hard, 8)
    kept = np.zeros_like(hard)
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) >= MIN_COMPONENT_AREA:
            kept[labels == label] = 1
    if not kept.any():
        raise ValueError("empty BiRefNet wood-fragment mask")
    return (kept * 255).astype(np.uint8)


def clean_fragment_rgba(rgba: Image.Image) -> Image.Image:
    arr = np.asarray(rgba, dtype=np.uint8).copy()
    rgb = arr[..., :3]
    alpha = keep_wood_components(arr[..., 3])
    opaque = alpha > 0
    near_edge = cv2.dilate((~opaque).astype(np.uint8), np.ones((3, 3), np.uint8), 2) > 0
    cyan_distance = np.linalg.norm(rgb.astype(np.float32) - base.CYAN, axis=2)
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


def process_frames(model, frames: list[Image.Image], indices: list[int]):
    processed = {}
    for count, index in enumerate(indices, 1):
        image = frames[index].convert("RGB")
        soft_alpha = np.asarray(common.predict_alpha(model, image), dtype=np.uint8)
        hard_alpha = keep_wood_components(soft_alpha)
        rgb = base.cyan_decontaminate(np.asarray(image, dtype=np.uint8), soft_alpha)
        processed[index] = (rgb, hard_alpha)
        print(f"[evil-treant-v02] BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


def main() -> None:
    common.OUT_DIR.mkdir(parents=True, exist_ok=True)
    common.PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    frames = common.decode(VIDEO)
    if len(frames) != ACTION["expectedFrames"]:
        raise ValueError(f"expected {ACTION['expectedFrames']} frames, got {len(frames)}")

    model = common.get_model()
    processed = process_frames(model, frames, ACTION["frames"])
    source_height = base.effective_height(processed[ACTION["frames"][0]][1])
    scale = base.TARGET_NEUTRAL_HEIGHT / source_height

    original_clean = common.clean_rgba
    common.clean_rgba = clean_fragment_rgba
    try:
        built = common.build_sheet("dying", ACTION, processed, scale)
    finally:
        common.clean_rgba = original_clean
    built["effectiveHeightRange"] = built.pop("bodyThicknessRange")

    manifest = {
        "asset": "evil-treant",
        "variant": "dying-fracture-v02",
        "sourceVideo": str(VIDEO.relative_to(ROOT)),
        "prompt": "prompts/evil-treant-dying-fracture-v02-h3.txt",
        "seed": 2026082605,
        "background": "#00FFFF",
        "normalization": "one fixed scale from the first neutral standing frame",
        "targetNeutralHeight": base.TARGET_NEUTRAL_HEIGHT,
        "sourceNeutralHeight": source_height,
        "scale": scale,
        "fragmentMask": {
            "method": "BiRefNet-general hard alpha with multi-component retention",
            "minimumComponentArea": MIN_COMPONENT_AREA,
        },
        "action": built,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[evil-treant-v02] built: {built}", flush=True)
    print(f"[evil-treant-v02] manifest -> {MANIFEST}", flush=True)


if __name__ == "__main__":
    main()
