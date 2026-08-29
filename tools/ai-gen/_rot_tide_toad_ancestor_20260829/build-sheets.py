#!/usr/bin/env python3
"""Build transparent, scale-locked, RIFE-interpolated toad boss sheets."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
REPO = TOOLS.parents[1]
sys.path.insert(0, str(TOOLS))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


VIDEO_DIR = ROOT / "videos"
FRAME_DIR = ROOT / "frames"
SOURCE_DIR = ROOT / "spritesheets" / "source-pre-rife"
FINAL_DIR = ROOT / "spritesheets" / "final"
REPORT_SOURCE_DIR = ROOT / "reports" / "sprites" / "source-pre-rife"
REPORT_FINAL_DIR = ROOT / "reports" / "sprites" / "final"
PREVIEW_DIR = ROOT / "previews" / "sprites" / "final"
RIFE_TOOL = TOOLS / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent
    / "_tmp"
    / "elise_audit"
    / "rife"
    / "rife-ncnn-vulkan-20221029-windows"
    / "rife-ncnn-vulkan.exe"
)

CELL_HEIGHT = 640
FOOT_Y = 560
TARGET_HEIGHT = 360.0
COLS = 8

ACTIONS = {
    "idle": {
        "video": "rot-tide-toad-idle-h3-v01.mp4",
        "frames": list(range(0, 120, 8)),
        "mode": "loop",
        "frameRate": 6.0,
        "cellWidth": 768,
        "centerX": 384,
        "anchor": "stabilized",
    },
    "moving": {
        "video": "rot-tide-toad-moving-h3-v01.mp4",
        "frames": list(range(11, 92, 5)),
        "mode": "loop",
        "frameRate": 10.0,
        "cellWidth": 1152,
        "centerX": 576,
        "anchor": "torso-stabilized",
        "preserveVerticalMotion": True,
    },
    "attacking": {
        "video": "rot-tide-toad-attacking-h3-v01.mp4",
        "frames": [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 102, 110],
        "mode": "one-shot",
        "frameRate": 12.0,
        "cellWidth": 1152,
        "centerX": 400,
        "anchor": "source-motion",
        "contactSourceFrame": 76,
    },
    "dying": {
        "video": "rot-tide-toad-dying-h3-v01.mp4",
        "frames": [0, 8, 16, 24, 30, 36, 42, 48, 54, 58, 62, 66, 70, 84, 123],
        "mode": "one-shot",
        "frameRate": 8.0,
        "cellWidth": 896,
        "centerX": 448,
        "anchor": "source-motion",
        "preserveVerticalMotion": True,
    },
    "tongue_sweep": {
        "video": "rot-tide-toad-tongue-sweep-h3-v01.mp4",
        "frames": [24, 30, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 102, 110, 118, 123],
        "mode": "one-shot",
        "frameRate": 12.0,
        "cellWidth": 1280,
        "centerX": 420,
        "anchor": "source-motion",
        "preserveVerticalMotion": True,
    },
    "body_slam": {
        "video": "rot-tide-toad-body-slam-h3-v01.mp4",
        "frames": [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 62, 64, 66, 68, 70, 72, 76, 80, 84, 88, 92, 96, 102, 110, 118, 123],
        "mode": "one-shot",
        "frameRate": 12.0,
        "cellWidth": 1152,
        "centerX": 576,
        "anchor": "source-motion",
        "preserveVerticalMotion": True,
    },
    "poison_belch": {
        "video": "rot-tide-toad-poison-belch-h3-v01.mp4",
        "frames": [12, 18, 24, 30, 36, 42, 48, 52, 56, 58, 60, 62, 64, 66, 70, 76, 82, 90, 100, 112, 123],
        "mode": "one-shot",
        "frameRate": 12.0,
        "cellWidth": 1152,
        "centerX": 470,
        "anchor": "source-motion",
        "preserveVerticalMotion": True,
        "removeForwardEmission": True,
    },
    "summon_croak": {
        "video": "rot-tide-toad-summon-croak-h3-v01.mp4",
        "frames": [16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 104, 112, 120, 123],
        "mode": "one-shot",
        "frameRate": 8.0,
        "cellWidth": 896,
        "centerX": 448,
        "anchor": "source-motion",
        "preserveVerticalMotion": True,
    },
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        return [frame.to_image().convert("RGB") for frame in container.decode(video=0)]


def bbox(alpha: np.ndarray, threshold: int = 10) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("empty alpha mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def remove_tiny_components(alpha: np.ndarray, minimum: int = 12) -> np.ndarray:
    count, labels = cv2.connectedComponents((alpha > 8).astype(np.uint8))
    if count <= 1:
        raise ValueError("empty cutout")
    keep = np.zeros(alpha.shape, dtype=bool)
    for label in range(1, count):
        component = labels == label
        if int(component.sum()) >= minimum:
            keep |= component
    result = alpha.copy()
    result[~keep] = 0
    return result


def remove_forward_emission(
    rgb: np.ndarray,
    alpha: np.ndarray,
    body_right: int,
    right_limit: int,
) -> tuple[np.ndarray, int]:
    """Remove all generated mouth VFX beyond a neutral-pose body boundary."""
    visible = alpha > 0
    x_grid = np.indices(alpha.shape)[1]
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    luminous_green = (
        visible
        & (x_grid > body_right - 80)
        & (g >= r + 10)
        & (g >= b + 6)
        & (g >= 96)
    )
    remove = visible & ((x_grid > right_limit) | luminous_green)
    result = alpha.copy()
    result[remove] = 0
    return result, int(remove.sum())


def torso_center(alpha: np.ndarray) -> tuple[float, float]:
    """Measure the broad body core without letting stretched feet move the root."""
    binary = (alpha >= 96).astype(np.uint8)
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    thick = distance >= 8.0
    count, labels = cv2.connectedComponents(thick.astype(np.uint8))
    candidates: list[tuple[int, float, float]] = []
    for label in range(1, count):
        ys, xs = np.where(labels == label)
        if len(xs) >= 64:
            candidates.append((len(xs), float(xs.mean()), float(ys.mean())))
    if candidates:
        _, center_x, center_y = max(candidates, key=lambda item: item[0])
        return center_x, center_y
    x0, y0, x1, y1 = bbox(alpha, 96)
    return (x0 + x1 - 1) / 2.0, (y0 + y1 - 1) / 2.0


def cutout(model, image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    semantic = np.asarray(predict_alpha(model, image.convert("RGB")), dtype=np.uint8)
    distance = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    white_alpha = np.clip((distance - 4.0) * (255.0 / 22.0), 0, 255).astype(np.uint8)
    alpha = remove_tiny_components(np.maximum(semantic, white_alpha))

    a = alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / np.maximum(a, 0.04)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return foreground, alpha


def paste_rgba(canvas: Image.Image, rgb: np.ndarray, alpha: np.ndarray, box: tuple[int, int, int, int], scale: float, x: int, y: int) -> None:
    x0, y0, x1, y1 = box
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB")
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L")
    size = (max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale)))
    crop_rgb = crop_rgb.resize(size, Image.Resampling.LANCZOS)
    crop_alpha = crop_alpha.resize(size, Image.Resampling.LANCZOS)
    rgba = crop_rgb.convert("RGBA")
    rgba.putalpha(crop_alpha)
    canvas.alpha_composite(rgba, (x, y))


def build_source(action: str, spec: dict, model) -> dict[str, object]:
    path = VIDEO_DIR / spec["video"]
    frames = decode(path)
    selected = spec["frames"]
    if max(selected) >= len(frames):
        raise ValueError(f"{action}: source has {len(frames)} frames")

    processed = []
    removed_forward_pixels = []
    action_frames = FRAME_DIR / action
    action_frames.mkdir(parents=True, exist_ok=True)
    neutral_body_right = None
    forward_limit = None
    for source_index in selected:
        rgb, alpha = cutout(model, frames[source_index])
        removed = 0
        if spec.get("removeForwardEmission"):
            if forward_limit is None:
                neutral_body_right = bbox(alpha)[2]
                forward_limit = neutral_body_right + 40
            alpha, removed = remove_forward_emission(
                rgb, alpha, neutral_body_right, forward_limit
            )
        box = bbox(alpha)
        processed.append((source_index, rgb, alpha, box))
        removed_forward_pixels.append(removed)

    _, _, first_alpha, first_box = processed[0]
    fx0, fy0, fx1, fy1 = first_box
    scale = TARGET_HEIGHT / (fy1 - fy0)
    source_offset_x = spec["centerX"] - ((fx0 + fx1) / 2.0) * scale
    source_offset_y = FOOT_Y - fy1 * scale
    _first_core_x, first_core_y = torso_center(first_alpha)
    target_core_y = source_offset_y + first_core_y * scale

    cell_w = spec["cellWidth"]
    rows = math.ceil(len(processed) / COLS)
    sheet = Image.new("RGBA", (cell_w * COLS, CELL_HEIGHT * rows), (0, 0, 0, 0))
    frame_reports = []
    for slot, (source_index, rgb, alpha, box) in enumerate(processed):
        x0, y0, x1, y1 = box
        if spec["anchor"] == "stabilized":
            x = round(spec["centerX"] - (x1 - x0) * scale / 2.0)
            y = round(FOOT_Y - (y1 - y0) * scale)
        elif spec["anchor"] == "torso-stabilized":
            core_x, core_y = torso_center(alpha)
            x = round(spec["centerX"] - (core_x - x0) * scale)
            # Lock the broad torso root in both axes. Limbs retain their authored
            # frame motion, but the locomotion loop no longer bobs as a whole.
            y = round(target_core_y - (core_y - y0) * scale)
        else:
            x = round(source_offset_x + x0 * scale)
            y = round(source_offset_y + y0 * scale)
        cell = Image.new("RGBA", (cell_w, CELL_HEIGHT), (0, 0, 0, 0))
        paste_rgba(cell, rgb, alpha, box, scale, x, y)
        cell_array = np.asarray(cell).copy()
        cell_array[cell_array[..., 3] == 0, :3] = 0
        cell = Image.fromarray(cell_array, "RGBA")
        cell.save(action_frames / f"key-{slot:02d}-source-{source_index:03d}.png")
        col = slot % COLS
        row = slot // COLS
        sheet.alpha_composite(cell, (col * cell_w, row * CELL_HEIGHT))
        placed = bbox(cell_array[..., 3])
        frame_reports.append({"slot": slot, "sourceFrame": source_index, "alphaBBox": list(placed)})

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    source_path = SOURCE_DIR / f"{action}.png"
    sheet.save(source_path)
    report = {
        "video": str(path.relative_to(ROOT)).replace("\\", "/"),
        "sourceFrameCount": len(frames),
        "selectedFrames": selected,
        "frameCount": len(selected),
        "frameRate": spec["frameRate"],
        "frameWidth": cell_w,
        "frameHeight": CELL_HEIGHT,
        "cols": COLS,
        "footY": FOOT_Y,
        "targetHeight": TARGET_HEIGHT,
        "fixedScale": scale,
        "mode": spec["mode"],
        "anchor": spec["anchor"],
        "removedForwardEmissionPixels": removed_forward_pixels,
        "frames": frame_reports,
    }
    report_path = REPORT_SOURCE_DIR / f"{action}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def run_rife(action: str, spec: dict, source_report: dict[str, object]) -> dict[str, object]:
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_FINAL_DIR.mkdir(parents=True, exist_ok=True)
    preview = PREVIEW_DIR / action
    command = [
        sys.executable,
        str(RIFE_TOOL),
        "--sheet", str(SOURCE_DIR / f"{action}.png"),
        "--out", str(FINAL_DIR / f"{action}.png"),
        "--name", f"rot-tide-toad-{action.replace('_', '-')}",
        "--frame-width", str(spec["cellWidth"]),
        "--frame-height", str(CELL_HEIGHT),
        "--cols", str(COLS),
        "--frame-count", str(source_report["frameCount"]),
        "--frame-rate", str(spec["frameRate"]),
        "--mode", spec["mode"],
        "--out-cols", str(COLS),
        "--preview-dir", str(preview),
        "--report", str(REPORT_FINAL_DIR / f"{action}-rife.json"),
        "--rife", str(RIFE_EXE),
    ]
    if spec.get("preserveVerticalMotion"):
        command.append("--preserve-vertical-motion")
    subprocess.run(command, check=True)
    report_path = REPORT_FINAL_DIR / f"{action}-rife.json"
    return json.loads(report_path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(ACTIONS))
    args = parser.parse_args()
    selected_actions = {args.only: ACTIONS[args.only]} if args.only else ACTIONS

    missing = [name for name, spec in selected_actions.items() if not (VIDEO_DIR / spec["video"]).exists()]
    if missing:
        raise SystemExit(f"missing source videos: {', '.join(missing)}")
    if not RIFE_EXE.exists():
        raise SystemExit(f"missing RIFE executable: {RIFE_EXE}")

    model = get_model()
    path = ROOT / "sprite-sheet-manifest.json"
    if args.only and path.exists():
        manifest = json.loads(path.read_text(encoding="utf-8"))
    else:
        manifest = {
            "pipeline": "approved MiniMax H3 white background -> BiRefNet plus white-distance detail retention -> fixed scale and action-specific root anchor -> RIFE v4.6 RGBA 2x",
            "referenceCell": CELL_HEIGHT,
            "footY": FOOT_Y,
            "targetHeight": TARGET_HEIGHT,
            "actions": {},
        }
    for action, spec in selected_actions.items():
        source = build_source(action, spec, model)
        final = run_rife(action, spec, source)
        manifest["actions"][action] = {"source": source, "final": final}
        print(f"[rot-tide-toad] built {action}", flush=True)

    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
