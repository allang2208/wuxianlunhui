#!/usr/bin/env python3
"""Build the accepted black-druid H3 videos into aligned RGBA sprite sheets.

Contracts:
- BiRefNet-general is loaded once for all five actions.
- Each action normalizes its first neutral pose to the miner-zombie humanoid
  target height. The scale then stays fixed within that action. This corrects
  deliberate camera zoom differences in the safe attack/death source videos.
- idle/walking/ritual stabilize torso and feet; attacking preserves the source
  lunge; dying preserves horizontal collapse while grounding every pose.
- Only the accepted v2/v3/v6 videos are valid runtime sources.
"""

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

TARGET_HEIGHT = 430
FOOT_Y = 489
CELL_HEIGHT = 512
EDGE_PAD = 16
ALPHA_THRESHOLD = 16

ACTIONS = {
    "idle": {
        "video": VIDEO_DIR / "black-druid-idle-v2.mp4",
        "frames": list(range(0, 120, 8)),
        "columns": 5,
        "mode": "stabilized",
        "frameRate": 6,
        "repeat": -1,
    },
    "walking": {
        # One complete gait loop; frame 51 is the near-duplicate endpoint.
        "video": VIDEO_DIR / "black-druid-walking-v2.mp4",
        "frames": list(range(13, 51, 2)),
        "columns": 5,
        "mode": "stabilized",
        "frameRate": 12,
        "repeat": -1,
    },
    "attacking": {
        "video": VIDEO_DIR / "black-druid-attacking-v3.mp4",
        "frames": list(range(8, 105, 4)),
        "columns": 5,
        "mode": "source_motion",
        "duration": 1000,
        "repeat": 0,
    },
    "ritual": {
        "video": VIDEO_DIR / "black-druid-ritual-v2.mp4",
        "frames": list(range(0, 121, 5)),
        "columns": 5,
        "mode": "stabilized",
        "duration": 3000,
        "repeat": 0,
    },
    "dying": {
        "video": VIDEO_DIR / "black-druid-dying-v6.mp4",
        "frames": list(range(31, 68, 3)) + [73],
        "columns": 5,
        "mode": "source_motion_grounded",
        "duration": 1600,
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


def keep_subject_component(alpha: np.ndarray) -> np.ndarray:
    """Keep the character and nearby detached cloth/limbs, discard watermarks."""
    foreground = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 64, ly - 64, lx + lw + 64, ly + lh + 64)
    keep = labels == largest
    for label in range(1, count):
        if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 16:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if x < expanded[2] and x + w > expanded[0] and y < expanded[3] and y + h > expanded[1]:
            keep |= labels == label
    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    cleaned = alpha.copy()
    cleaned[~keep] = 0
    cleaned[cleaned < 4] = 0
    return cleaned


def torso_x(alpha: np.ndarray) -> float:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    height = y1 - y0
    band0 = y0 + round(height * 0.28)
    band1 = y0 + round(height * 0.62)
    _ys, xs = np.where(alpha[band0:band1] > 32)
    if not len(xs):
        return (x0 + x1 - 1) / 2
    return float(np.median(xs))


def white_decontaminate(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Reverse the white matte on antialiased pixels and zero transparent RGB."""
    a = alpha.astype(np.float32)[..., None] / 255.0
    safe = np.maximum(a, 0.04)
    foreground = (rgb.astype(np.float32) - 255.0 * (1.0 - a)) / safe
    foreground = np.clip(foreground, 0, 255)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground.astype(np.uint8)


def process_frames(model, frames: list[Image.Image], indices: list[int], name: str):
    processed = {}
    for count, index in enumerate(indices, 1):
        rgb_image = frames[index].convert("RGB")
        alpha = np.squeeze(np.asarray(predict_alpha(model, rgb_image)))
        if alpha.shape != np.asarray(rgb_image).shape[:2]:
            alpha = cv2.resize(alpha, rgb_image.size, interpolation=cv2.INTER_LINEAR)
        if alpha.max(initial=0) <= 1.5:
            alpha = alpha * 255.0
        alpha = keep_subject_component(np.clip(alpha, 0, 255).astype(np.uint8))
        rgb = np.asarray(rgb_image, dtype=np.uint8)
        processed[index] = (white_decontaminate(rgb, alpha), alpha)
        print(f"[black-druid] {name} BiRefNet {count}/{len(indices)} frame={index}", flush=True)
    return processed


def choose_cell_width(required_half_span: float) -> int:
    required = math.ceil(2 * (required_half_span + EDGE_PAD))
    for width in (512, 640, 768, 896, 1024, 1152):
        if width >= required:
            return width
    raise ValueError(f"content requires unsupported cell width {required}")


def frame_extents(alpha: np.ndarray, scale: float, mode: str, ref_x: float) -> tuple[float, float]:
    x0, _y0, x1, _y1 = bbox_from_alpha(alpha)
    anchor = torso_x(alpha) if mode == "stabilized" else ref_x
    return (x0 - anchor) * scale, (x1 - anchor) * scale


def make_cell(
    rgb: np.ndarray,
    alpha: np.ndarray,
    scale: float,
    cell_width: int,
    mode: str,
    ref_x: float,
    ref_foot_y: int,
) -> Image.Image:
    x0, y0, x1, y1 = bbox_from_alpha(alpha)
    target_w = max(1, round((x1 - x0) * scale))
    target_h = max(1, round((y1 - y0) * scale))
    crop_rgb = Image.fromarray(rgb[y0:y1, x0:x1], "RGB").resize(
        (target_w, target_h), Image.Resampling.LANCZOS
    )
    crop_alpha = Image.fromarray(alpha[y0:y1, x0:x1], "L").resize(
        (target_w, target_h), Image.Resampling.LANCZOS
    )

    if mode == "stabilized":
        anchor_x = torso_x(alpha)
        source_foot = y1 - 1
    else:
        anchor_x = ref_x
        source_foot = y1 - 1 if mode == "source_motion_grounded" else ref_foot_y

    dst_x = round(cell_width / 2 + (x0 - anchor_x) * scale)
    dst_y = round(FOOT_Y + (y0 - source_foot) * scale)
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


def preview_rgb(cell: Image.Image) -> Image.Image:
    bg = Image.new("RGB", cell.size, (30, 32, 38))
    bg.paste(cell.convert("RGB"), (0, 0), cell.getchannel("A"))
    return bg.resize((round(cell.width * 0.5), 256), Image.Resampling.LANCZOS)


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

    columns = spec["columns"]
    rows = math.ceil(len(cells) / columns)
    sheet = Image.new("RGBA", (cell_width * columns, CELL_HEIGHT * rows), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((index % columns) * cell_width, (index // columns) * CELL_HEIGHT))
    out_path = OUT_DIR / f"{name}.png"
    sheet.save(out_path)

    preview_frames = [preview_rgb(cell) for cell in cells]
    frame_ms = round((spec.get("duration", 1000 / spec.get("frameRate", 8))) / len(cells))
    if "frameRate" in spec:
        frame_ms = round(1000 / spec["frameRate"])
    preview_path = PREVIEW_DIR / f"{name}.gif"
    preview_frames[0].save(
        preview_path,
        save_all=True,
        append_images=preview_frames[1:],
        duration=frame_ms,
        loop=0,
        disposal=2,
    )

    counts = []
    feet = []
    edge_hits = []
    transparent_rgb = []
    bboxes = []
    for index, cell in enumerate(cells):
        pixels = np.asarray(cell)
        alpha = pixels[..., 3]
        ys, xs = np.where(alpha > ALPHA_THRESHOLD)
        counts.append(int(len(xs)))
        feet.append(int(ys.max()))
        bboxes.append([int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
        if ((alpha[:2] > ALPHA_THRESHOLD).any() or (alpha[-2:] > ALPHA_THRESHOLD).any()
                or (alpha[:, :2] > ALPHA_THRESHOLD).any() or (alpha[:, -2:] > ALPHA_THRESHOLD).any()):
            edge_hits.append(index)
        transparent_rgb.append(int(pixels[..., :3][alpha == 0].max(initial=0)))

    return {
        "file": str(out_path.relative_to(ROOT)),
        "preview": str(preview_path.relative_to(ROOT)),
        "frameWidth": cell_width,
        "frameHeight": CELL_HEIGHT,
        "columns": columns,
        "rows": rows,
        "frameCount": len(cells),
        "footY": FOOT_Y,
        "sourceFrames": spec["frames"],
        "mode": spec["mode"],
        "alphaPixels": [min(counts), max(counts)],
        "feetRange": [min(feet), max(feet)],
        "edgeHitFrames": edge_hits,
        "transparentRgbMax": max(transparent_rgb),
        "bboxes": bboxes,
        **({"frameRate": spec["frameRate"]} if "frameRate" in spec else {}),
        **({"duration": spec["duration"]} if "duration" in spec else {}),
        "repeat": spec["repeat"],
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {name: decode(spec["video"]) for name, spec in ACTIONS.items()}
    for name, frames in decoded.items():
        last = max(ACTIONS[name]["frames"])
        if last >= len(frames):
            raise ValueError(f"{name}: frame {last} outside decoded length {len(frames)}")

    model = get_model()
    processed = {
        name: process_frames(model, decoded[name], spec["frames"], name)
        for name, spec in ACTIONS.items()
    }
    reference_heights = {}
    action_scales = {}
    for name, spec in ACTIONS.items():
        ref_alpha = processed[name][spec["frames"][0]][1]
        _x0, y0, _x1, y1 = bbox_from_alpha(ref_alpha)
        reference_heights[name] = y1 - y0
        action_scales[name] = TARGET_HEIGHT / reference_heights[name]

    manifest = {
        "sourceContract": "accepted only: idle-v2, walking-v2, attacking-v3, ritual-v2, dying-v6",
        "referenceHeights": reference_heights,
        "targetHeight": TARGET_HEIGHT,
        "actionScales": action_scales,
        "actions": {},
    }
    for name, spec in ACTIONS.items():
        manifest["actions"][name] = build_sheet(
            name, spec, processed[name], action_scales[name]
        )
        print(f"[black-druid] built {name}: {manifest['actions'][name]}", flush=True)

    manifest_path = ROOT / "sheet-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[black-druid] manifest -> {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
