#!/usr/bin/env python3
"""Rebuild the upgraded ordinary-zombie H3 videos into aligned RGBA sheets.

Contracts:
- BiRefNet-general is loaded once and supplies every frame alpha.
- All actions share one global scale measured from idle frame 0.
- idle/walking stabilize the torso and foot line to remove video drift.
- attacking/dying preserve source-space motion relative to their first frame,
  so the lunge/collapse stays visible without cross-action teleporting.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import numpy as np
from PIL import Image

import sys

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "video"
OUT_DIR = ROOT / "generated"
PREVIEW_DIR = ROOT / "previews"

TARGET_HEIGHT = 430
FOOT_Y = 489
CELL_HEIGHT = 512
EDGE_PAD = 12
ALPHA_THRESHOLD = 16

ACTIONS = {
    "idle": {
        "video": VIDEO_DIR / "zombie-idle.mp4",
        "frames": list(range(0, 120, 5)),
        "cols": 6,
        "mode": "stabilized",
        "frame_rate": 5,
        "repeat": -1,
    },
    "walking": {
        "video": VIDEO_DIR / "zombie-walking.mp4",
        "frames": list(range(35, 89, 2)),
        "cols": 6,
        "mode": "stabilized",
        "frame_rate": 12,
        "repeat": -1,
    },
    "attacking": {
        "video": VIDEO_DIR / "zombie-attacking.mp4",
        "frames": list(range(0, 96, 4)),
        "cols": 6,
        "mode": "source_motion",
        "duration": 1000,
        "repeat": 0,
    },
    "dying": {
        "video": VIDEO_DIR / "zombie-dying.mp4",
        "frames": list(range(0, 96, 4)),
        "cols": 6,
        "mode": "source_motion_grounded",
        "duration": 2000,
        "repeat": 0,
    },
}


def decode(path: Path) -> list[Image.Image]:
    with av.open(str(path)) as container:
        return [Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
                for frame in container.decode(video=0)]


def bbox_from_alpha(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if not len(xs):
        raise ValueError("empty BiRefNet mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def torso_x(alpha: np.ndarray) -> float:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    height = y1 - y0
    band0 = y0 + round(height * 0.30)
    band1 = y0 + round(height * 0.56)
    ys, xs = np.where(alpha[band0:band1] > ALPHA_THRESHOLD)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    return float(np.median(xs))


def white_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Reverse white compositing at antialiased edges to prevent pale halos."""
    a = alpha.astype(np.float32)[..., None] / 255.0
    safe = np.maximum(a, 0.04)
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / safe
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def process_frames(model, frames: list[Image.Image], indices: list[int]):
    processed = {}
    for count, index in enumerate(indices, 1):
        rgb_image = frames[index].convert("RGB")
        alpha = np.asarray(predict_alpha(model, rgb_image), dtype=np.uint8)
        rgb = np.asarray(rgb_image, dtype=np.uint8)
        clean_rgb = white_decontaminate(rgb, alpha)
        processed[index] = (clean_rgb, alpha)
        print(f"[zombie-sheets] BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


def choose_cell_width(required_half_span: float) -> int:
    required = math.ceil(2 * (required_half_span + EDGE_PAD))
    for width in (512, 640, 768, 896, 1024, 1152):
        if width >= required:
            return width
    raise ValueError(f"content requires unsupported cell width {required}")


def make_cell(rgb: np.ndarray, alpha: np.ndarray, scale: float,
              cell_width: int, mode: str, ref_x: float, ref_foot_y: int) -> Image.Image:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB")
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L")
    target_w = max(1, round((x1 - x0) * scale))
    target_h = max(1, round((y1 - y0) * scale))
    crop_rgb = crop_rgb.resize((target_w, target_h), Image.Resampling.LANCZOS)
    crop_alpha = crop_alpha.resize((target_w, target_h), Image.Resampling.LANCZOS)

    if mode == "stabilized":
        anchor_x = torso_x(alpha)
        source_foot = y1 - 1
        dst_anchor_x = cell_width / 2
        dst_foot = FOOT_Y
    else:
        anchor_x = ref_x
        source_foot = y1 - 1 if mode == "source_motion_grounded" else ref_foot_y
        dst_anchor_x = cell_width / 2
        dst_foot = FOOT_Y

    dst_x = round(dst_anchor_x + (x0 - anchor_x) * scale)
    dst_y = round(dst_foot + (y0 - source_foot) * scale)
    if dst_x < 0 or dst_y < 0 or dst_x + target_w > cell_width or dst_y + target_h > CELL_HEIGHT:
        raise ValueError(
            f"frame content out of cell: {target_w}x{target_h} at ({dst_x},{dst_y}) "
            f"inside {cell_width}x{CELL_HEIGHT}"
        )
    cell = Image.new("RGBA", (cell_width, CELL_HEIGHT), (0, 0, 0, 0))
    rgba = crop_rgb.convert("RGBA")
    rgba.putalpha(crop_alpha)
    cell.alpha_composite(rgba, (dst_x, dst_y))
    return cell


def frame_extents(alpha: np.ndarray, scale: float, mode: str,
                  ref_x: float) -> tuple[float, float]:
    x0, _y0, x1, _y1 = bbox_from_alpha(alpha)
    anchor = torso_x(alpha) if mode == "stabilized" else ref_x
    return (x0 - anchor) * scale, (x1 - anchor) * scale


def build_sheet(name: str, spec: dict, frames: list[Image.Image], processed: dict,
                scale: float) -> dict:
    first_rgb, first_alpha = processed[spec["frames"][0]]
    first_bbox = bbox_from_alpha(first_alpha)
    ref_x = torso_x(first_alpha)
    ref_foot_y = first_bbox[3] - 1
    spans = [frame_extents(processed[index][1], scale, spec["mode"], ref_x)
             for index in spec["frames"]]
    required_half = max(max(abs(left), abs(right)) for left, right in spans)
    cell_width = choose_cell_width(required_half)

    cells = [make_cell(*processed[index], scale, cell_width, spec["mode"], ref_x, ref_foot_y)
             for index in spec["frames"]]
    cols = spec["cols"]
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGBA", (cell_width * cols, CELL_HEIGHT * rows), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((i % cols) * cell_width, (i // cols) * CELL_HEIGHT))
    out = OUT_DIR / f"{name}.png"
    sheet.save(out)

    previews = []
    for cell in cells:
        bg = Image.new("RGB", cell.size, (30, 30, 34))
        bg.paste(cell.convert("RGB"), (0, 0), cell.getchannel("A"))
        previews.append(bg.resize((round(cell_width * 0.5), 256), Image.Resampling.LANCZOS))
    preview_path = PREVIEW_DIR / f"{name}.gif"
    if "duration" in spec:
        duration = spec["duration"] / len(cells)
    else:
        duration = 1000 / spec["frame_rate"]
    previews[0].save(preview_path, save_all=True, append_images=previews[1:],
                     duration=round(duration), loop=0, disposal=2)

    counts = []
    feet = []
    edge_hits = []
    torso_centers = []
    for i, cell in enumerate(cells):
        a = np.asarray(cell.getchannel("A"))
        ys, xs = np.where(a > ALPHA_THRESHOLD)
        counts.append(int(len(xs)))
        feet.append(int(ys.max()))
        torso_centers.append(round(torso_x(a), 2))
        edge = bool((a[:2] > ALPHA_THRESHOLD).any() or (a[-2:] > ALPHA_THRESHOLD).any()
                    or (a[:, :2] > ALPHA_THRESHOLD).any() or (a[:, -2:] > ALPHA_THRESHOLD).any())
        if edge:
            edge_hits.append(i)

    return {
        "file": str(out.relative_to(ROOT)),
        "preview": str(preview_path.relative_to(ROOT)),
        "frameWidth": cell_width,
        "frameHeight": CELL_HEIGHT,
        "columns": cols,
        "rows": rows,
        "frameCount": len(cells),
        "footY": FOOT_Y,
        "sourceFrames": spec["frames"],
        "mode": spec["mode"],
        "alphaPixels": [min(counts), max(counts)],
        "feetRange": [min(feet), max(feet)],
        "torsoCenterRange": [min(torso_centers), max(torso_centers)],
        "edgeHitFrames": edge_hits,
        **({"frameRate": spec["frame_rate"]} if "frame_rate" in spec else {}),
        **({"duration": spec["duration"]} if "duration" in spec else {}),
        "repeat": spec["repeat"],
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: decode(spec["video"]) for name, spec in ACTIONS.items()}
    for name, frames in decoded.items():
        if len(frames) != 124:
            raise ValueError(f"{name}: expected 124 video frames, got {len(frames)}")

    model = get_model()
    processed = {
        name: process_frames(model, decoded[name], spec["frames"])
        for name, spec in ACTIONS.items()
    }
    ref_alpha = processed["idle"][ACTIONS["idle"]["frames"][0]][1]
    x0, y0, x1, y1 = bbox_from_alpha(ref_alpha)
    scale = TARGET_HEIGHT / (y1 - y0)

    manifest = {
        "referenceHeight": y1 - y0,
        "targetHeight": TARGET_HEIGHT,
        "globalScale": scale,
        "actions": {},
    }
    for name, spec in ACTIONS.items():
        manifest["actions"][name] = build_sheet(
            name, spec, decoded[name], processed[name], scale
        )
        print(f"[zombie-sheets] built {name}: {manifest['actions'][name]}", flush=True)

    manifest_path = ROOT / "sheet-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[zombie-sheets] manifest -> {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
