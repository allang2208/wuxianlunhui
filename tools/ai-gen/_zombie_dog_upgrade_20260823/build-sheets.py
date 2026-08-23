#!/usr/bin/env python3
"""Build aligned transparent zombie-dog sheets from the accepted H3 videos."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "video"
OUT_DIR = ROOT / "generated" / "final"
PREVIEW_DIR = ROOT / "previews" / "final"

# Wolf-family contract: 262 px visible height inside a 512 reference cell.
TARGET_HEIGHT = 262
FOOT_Y = 410
CELL_HEIGHT = 512
REFERENCE_CELL = 512
EDGE_PAD = 14
ALPHA_THRESHOLD = 16
HARD_ALPHA = 245

ACTIONS = {
    "idle": {
        "video": VIDEO_DIR / "zombie-dog-idle.mp4",
        "frames": list(range(0, 120, 10)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 3,
        "repeat": -1,
    },
    "walk": {
        # One detected 38-frame gait period (20..57), sampled at 12 FPS.
        "video": VIDEO_DIR / "zombie-dog-walking.mp4",
        "frames": list(range(20, 58, 2)),
        "cols": 5,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
    },
    "run": {
        # One detected 44-frame gait period (24..67), sampled at 12 FPS.
        "video": VIDEO_DIR / "zombie-dog-running.mp4",
        "frames": list(range(24, 68, 2)),
        "cols": 6,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
    },
    "attack": {
        # Low horizontal bite window; source-space X/Y motion keeps the lunge.
        "video": VIDEO_DIR / "zombie-dog-attacking.mp4",
        "frames": list(range(10, 59, 3)),
        "cols": 6,
        "mode": "source_motion",
        "duration": 700,
        "repeat": 0,
    },
    "death": {
        # Dense collapse frames followed by two settled-corpse frames.
        "video": VIDEO_DIR / "zombie-dog-dying.mp4",
        "frames": list(range(0, 46, 3)) + [56, 78],
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 1800,
        "repeat": 0,
    },
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        return [
            Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
            for frame in container.decode(video=0)
        ]


def bbox_from_alpha(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if not len(xs):
        raise ValueError("empty BiRefNet mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def torso_x(alpha: np.ndarray) -> float:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    height = y1 - y0
    band0 = y0 + round(height * 0.30)
    band1 = y0 + round(height * 0.60)
    _ys, xs = np.where(alpha[band0:band1] > ALPHA_THRESHOLD)
    return float(np.median(xs)) if len(xs) else (x0 + x1 - 1) / 2


def white_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Reverse compositing against the H3 white background at soft edges."""
    a = alpha.astype(np.float32)[..., None] / 255.0
    safe = np.maximum(a, 0.04)
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / safe
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def clean_rgba(rgba: Image.Image) -> Image.Image:
    """Apply the quadruped CLEAN contract per cell without changing geometry."""
    arr = np.asarray(rgba, dtype=np.uint8).copy()
    rgb = arr[..., :3]
    alpha = np.where(arr[..., 3] >= HARD_ALPHA, 255, 0).astype(np.uint8)

    count, labels = cv2.connectedComponents((alpha > 0).astype(np.uint8))
    if count > 2:
        areas = [(int((labels == i).sum()), i) for i in range(1, count)]
        keep = max(areas)[1]
        alpha[(labels > 0) & (labels != keep)] = 0

    # Replace remaining near-white edge pixels with a local opaque-color mean.
    opaque = alpha > 0
    trans_near = cv2.dilate((~opaque).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2) > 0
    dist_white = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    polluted = opaque & trans_near & (dist_white < 45)
    if polluted.any():
        good = opaque & ~polluted
        count_good = cv2.blur(good.astype(np.float32), (7, 7)) * 49.0
        means = np.stack([
            cv2.blur((rgb[..., ch] * good).astype(np.float32), (7, 7)) * 49.0
            for ch in range(3)
        ], axis=-1) / np.maximum(count_good[..., None], 1.0)
        replacement = np.clip(means, 0, 255).astype(np.uint8)
        replacement[count_good < 1] = 24
        rgb[polluted] = replacement[polluted]

    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def process_frames(model, frames: list[Image.Image], indices: list[int], action: str):
    processed = {}
    for count, index in enumerate(indices, 1):
        image = frames[index].convert("RGB")
        alpha = np.asarray(predict_alpha(model, image), dtype=np.uint8)
        rgb = white_decontaminate(np.asarray(image, dtype=np.uint8), alpha)
        processed[index] = (rgb, alpha)
        print(f"[zombie-dog] {action} BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


def choose_cell_width(required_half_span: float) -> int:
    required = math.ceil(2 * (required_half_span + EDGE_PAD))
    for width in (512, 640, 768, 896, 1024, 1152):
        if width >= required:
            return width
    raise ValueError(f"content requires unsupported cell width {required}")


def frame_extents(alpha: np.ndarray, scale: float, mode: str, ref_x: float):
    x0, _y0, x1, _y1 = bbox_from_alpha(alpha)
    anchor = torso_x(alpha) if mode == "stabilized" else ref_x
    return (x0 - anchor) * scale, (x1 - anchor) * scale


def make_cell(rgb: np.ndarray, alpha: np.ndarray, scale: float, cell_width: int,
              mode: str, ref_x: float, ref_foot_y: int) -> Image.Image:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB")
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L")
    target_w = max(1, round((x1 - x0) * scale))
    target_h = max(1, round((y1 - y0) * scale))
    crop_rgb = crop_rgb.resize((target_w, target_h), Image.Resampling.LANCZOS)
    crop_alpha = crop_alpha.resize((target_w, target_h), Image.Resampling.LANCZOS)

    if mode == "stabilized":
        source_anchor_x = torso_x(alpha)
        source_foot_y = y1 - 1
    else:
        source_anchor_x = ref_x
        source_foot_y = y1 - 1 if mode == "source_motion_grounded" else ref_foot_y

    dst_x = round(cell_width / 2 + (x0 - source_anchor_x) * scale)
    dst_y = round(FOOT_Y + (y0 - source_foot_y) * scale)
    if dst_x < 0 or dst_y < 0 or dst_x + target_w > cell_width or dst_y + target_h > CELL_HEIGHT:
        raise ValueError(
            f"frame content out of cell: {target_w}x{target_h} at ({dst_x},{dst_y}) "
            f"inside {cell_width}x{CELL_HEIGHT}"
        )

    cell = Image.new("RGBA", (cell_width, CELL_HEIGHT), (0, 0, 0, 0))
    cutout = crop_rgb.convert("RGBA")
    cutout.putalpha(crop_alpha)
    cell.alpha_composite(cutout, (dst_x, dst_y))
    return clean_rgba(cell)


def build_sheet(name: str, spec: dict, processed: dict, scale: float) -> dict:
    first_alpha = processed[spec["frames"][0]][1]
    first_bbox = bbox_from_alpha(first_alpha)
    ref_x = torso_x(first_alpha)
    ref_foot_y = first_bbox[3] - 1
    spans = [
        frame_extents(processed[index][1], scale, spec["mode"], ref_x)
        for index in spec["frames"]
    ]
    required_half = max(max(abs(left), abs(right)) for left, right in spans)
    cell_width = choose_cell_width(required_half)
    cells = [
        make_cell(*processed[index], scale, cell_width, spec["mode"], ref_x, ref_foot_y)
        for index in spec["frames"]
    ]

    cols = spec["cols"]
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGBA", (cell_width * cols, CELL_HEIGHT * rows), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((i % cols) * cell_width, (i // cols) * CELL_HEIGHT))
    out = OUT_DIR / f"{name}.png"
    sheet.save(out)

    preview_frames = []
    for cell in cells:
        bg = Image.new("RGB", cell.size, (30, 30, 34))
        bg.paste(cell.convert("RGB"), (0, 0), cell.getchannel("A"))
        preview_frames.append(bg.resize((round(cell_width * 0.5), 256), Image.Resampling.LANCZOS))
    frame_ms = spec.get("duration", 1000 / spec.get("frameRate", 8)) / len(cells) \
        if "duration" in spec else 1000 / spec["frameRate"]
    preview = PREVIEW_DIR / f"{name}.gif"
    preview_frames[0].save(
        preview, save_all=True, append_images=preview_frames[1:],
        duration=round(frame_ms), loop=0, disposal=2,
    )

    alpha_pixels = []
    feet = []
    torso_centers = []
    edge_hits = []
    blank_frames = []
    semi_pixels = 0
    transparent_rgb = 0
    for i, cell in enumerate(cells):
        arr = np.asarray(cell, dtype=np.uint8)
        alpha = arr[..., 3]
        ys, xs = np.where(alpha > ALPHA_THRESHOLD)
        if not len(xs):
            blank_frames.append(i)
            continue
        alpha_pixels.append(int(len(xs)))
        feet.append(int(ys.max()))
        torso_centers.append(round(torso_x(alpha), 2))
        semi_pixels += int(((alpha > 0) & (alpha < 255)).sum())
        transparent_rgb += int(((alpha == 0) & (arr[..., :3].max(axis=2) > 0)).sum())
        if ((alpha[:2] > 0).any() or (alpha[-2:] > 0).any()
                or (alpha[:, :2] > 0).any() or (alpha[:, -2:] > 0).any()):
            edge_hits.append(i)

    return {
        "file": str(out.relative_to(ROOT)),
        "preview": str(preview.relative_to(ROOT)),
        "frameWidth": cell_width,
        "frameHeight": CELL_HEIGHT,
        "columns": cols,
        "rows": rows,
        "frameCount": len(cells),
        "footY": FOOT_Y,
        "sourceFrames": spec["frames"],
        "mode": spec["mode"],
        "alphaPixels": [min(alpha_pixels), max(alpha_pixels)],
        "feetRange": [min(feet), max(feet)],
        "torsoCenterRange": [min(torso_centers), max(torso_centers)],
        "blankFrames": blank_frames,
        "edgeHitFrames": edge_hits,
        "semiPixels": semi_pixels,
        "transparentRgbPixels": transparent_rgb,
        **({"frameRate": spec["frameRate"]} if "frameRate" in spec else {}),
        **({"duration": spec["duration"]} if "duration" in spec else {}),
        "repeat": spec["repeat"],
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: decode(spec["video"]) for name, spec in ACTIONS.items()}
    for name, frames in decoded.items():
        if len(frames) != 124:
            raise ValueError(f"{name}: expected 124 frames, got {len(frames)}")

    model = get_model()
    processed = {
        name: process_frames(model, decoded[name], spec["frames"], name)
        for name, spec in ACTIONS.items()
    }
    ref_alpha = processed["idle"][ACTIONS["idle"]["frames"][0]][1]
    _x0, y0, _x1, y1 = bbox_from_alpha(ref_alpha)
    scale = TARGET_HEIGHT / (y1 - y0)
    manifest = {
        "referenceCell": REFERENCE_CELL,
        "referenceHeight": y1 - y0,
        "targetHeight": TARGET_HEIGHT,
        "globalScale": scale,
        "actions": {},
    }
    for name, spec in ACTIONS.items():
        manifest["actions"][name] = build_sheet(name, spec, processed[name], scale)
        print(f"[zombie-dog] built {name}: {manifest['actions'][name]}", flush=True)

    path = ROOT / "sheet-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[zombie-dog] manifest -> {path}", flush=True)


if __name__ == "__main__":
    main()
