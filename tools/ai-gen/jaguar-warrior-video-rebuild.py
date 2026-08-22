#!/usr/bin/env python3
"""Rebuild the Jaguar Warrior's four animation sheets from two local videos.

Source contract (24 fps, 720x720):
  video 1: idle f0..f46 sampled every 2 frames; run loop f80..f99
  video 2: attack 0..2s; dying 3..5s

The script uses one fixed scale per source video, BiRefNet alpha, a 480/512
ground line, and per-action cell sizes. It writes candidate sheets and visual
previews; callers copy accepted sheets into assets/companions/jaguar_warrior.

Run with the ComfyUI venv Python from the repository root.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from rmbg_cutout import get_model, predict_alpha


@dataclass(frozen=True)
class ActionSpec:
    name: str
    source: str
    indices: tuple[int, ...]
    playback_fps: float
    repeat: int
    anchor: str


def decode_video(path: Path) -> tuple[list[np.ndarray], float]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    fps = float(stream.average_rate)
    frames = [np.asarray(frame.to_image().convert("RGB")) for frame in container.decode(stream)]
    container.close()
    if not frames or fps <= 0:
        raise RuntimeError(f"Unable to decode video: {path}")
    return frames, fps


def visual_resample_indices(
    frames: list[np.ndarray], start: int, end_exclusive: int, count: int
) -> tuple[int, ...]:
    """Sample a one-shot action at equal accumulated visual-distance intervals."""
    if start < 0 or end_exclusive > len(frames) or start >= end_exclusive:
        raise ValueError(f"Invalid frame window {start}:{end_exclusive} for {len(frames)} frames")
    window = frames[start:end_exclusive]
    if count <= 1:
        return (start,)

    small = [
        cv2.resize(cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY), (180, 180), interpolation=cv2.INTER_AREA)
        for frame in window
    ]
    distances = [0.0]
    for previous, current in zip(small, small[1:]):
        # Ignore almost-white background and generator marks; motion inside the
        # character dominates the accumulated path.
        foreground = np.minimum(previous, current) < 244
        if foreground.any():
            diff = float(np.abs(current.astype(np.float32) - previous)[foreground].mean())
        else:
            diff = 0.0
        distances.append(max(diff, 1e-4))
    cumulative = np.cumsum(distances)
    targets = np.linspace(0.0, float(cumulative[-1]), count)
    picked = [int(np.argmin(np.abs(cumulative - target))) + start for target in targets]

    # Keep indices strictly increasing; fall back to time-uniform sampling when
    # a long static hold collapses several visual-distance targets together.
    if len(set(picked)) != count:
        picked = np.rint(np.linspace(start, end_exclusive - 1, count)).astype(int).tolist()
    return tuple(picked)


def keep_subject_component(alpha: np.ndarray) -> np.ndarray:
    foreground = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 48, ly - 48, lx + lw + 48, ly + lh + 48)

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


def cutout_rgba(rgb: np.ndarray, model) -> np.ndarray:
    alpha = np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB")))
    alpha = np.squeeze(alpha)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = keep_subject_component(np.clip(alpha, 0, 255).astype(np.uint8))

    # Reverse the original white matte on semi-transparent edge pixels. This
    # preserves the white muzzle while removing the white video halo.
    clean_rgb = rgb.astype(np.float32).copy()
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        af = a[semi, None]
        clean_rgb[semi] = np.clip((clean_rgb[semi] - (1.0 - af) * 255.0) / af, 0, 255)
    clean_rgb[a <= 0.02] = 0
    return np.dstack([clean_rgb.astype(np.uint8), alpha])


def alpha_bbox(rgba: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("Empty cutout frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def horizontal_anchor(rgba: np.ndarray, mode: str) -> float:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    alpha = rgba[..., 3]
    if mode == "torso":
        top = y0 + round((y1 - y0 + 1) * 0.28)
        bottom = y0 + round((y1 - y0 + 1) * 0.64)
        ys, xs = np.where(alpha[top:bottom + 1] > 32)
    elif mode == "feet":
        top = y0 + round((y1 - y0 + 1) * 0.82)
        ys, xs = np.where(alpha[top:y1 + 1] > 32)
    elif mode == "bbox":
        return (x0 + x1) / 2.0
    else:
        raise ValueError(f"Unknown anchor mode: {mode}")
    if not len(xs):
        return (x0 + x1) / 2.0
    # Median is robust against the long spear crossing the torso band.
    return float(np.median(xs))


def round_cell(value: float, minimum: int = 512) -> int:
    return max(minimum, int(math.ceil(value / 128.0) * 128))


def choose_cell(
    frames: list[np.ndarray], anchors: list[float], scale: float, margin: int = 16
) -> tuple[int, int]:
    half_width = 0.0
    max_height = 0.0
    for rgba, anchor in zip(frames, anchors):
        x0, y0, x1, y1 = alpha_bbox(rgba)
        half_width = max(half_width, (anchor - x0) * scale, (x1 - anchor + 1) * scale)
        max_height = max(max_height, (y1 - y0 + 1) * scale)
    cell_w = round_cell(half_width * 2 + margin * 2)
    cell_h = 512
    while cell_h * 0.9375 - margin < max_height:
        cell_h += 128
    if cell_w > 1024 or cell_h > 1024:
        raise RuntimeError(f"Required cell {cell_w}x{cell_h} exceeds supported 1024px limit")
    return cell_w, cell_h


def place_cell(
    rgba: np.ndarray, anchor: float, scale: float, cell_w: int, cell_h: int
) -> np.ndarray:
    x0, y0, x1, y1 = alpha_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    )
    local_anchor = (anchor - x0) * scale
    offset_x = round(cell_w / 2 - local_anchor)
    feet_y = round(cell_h * 0.9375)
    offset_y = feet_y - height
    if offset_x < 0 or offset_y < 0 or offset_x + width > cell_w or offset_y + height > cell_h:
        raise RuntimeError(
            f"Frame placement clips: crop={width}x{height} at ({offset_x},{offset_y}) "
            f"inside {cell_w}x{cell_h}"
        )
    cell = np.zeros((cell_h, cell_w, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose_sheet(cells: list[np.ndarray], cols: int = 8) -> np.ndarray:
    rows = math.ceil(len(cells) / cols)
    cell_h, cell_w = cells[0].shape[:2]
    sheet = np.zeros((rows * cell_h, cols * cell_w, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * cell_h:(row + 1) * cell_h, col * cell_w:(col + 1) * cell_w] = cell
    return sheet


def checkerboard(width: int, height: int, block: int = 24) -> np.ndarray:
    yy, xx = np.indices((height, width))
    light = ((xx // block + yy // block) % 2) == 0
    out = np.empty((height, width, 3), np.uint8)
    out[light] = (64, 68, 74)
    out[~light] = (38, 42, 48)
    return out


def preview_rgb(cell: np.ndarray) -> np.ndarray:
    bg = checkerboard(cell.shape[1], cell.shape[0]).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    return np.clip(cell[..., :3] * alpha + bg * (1.0 - alpha), 0, 255).astype(np.uint8)


def save_previews(
    action: str,
    cells: list[np.ndarray],
    indices: tuple[int, ...],
    fps: float,
    out_dir: Path,
) -> None:
    gif_frames = [Image.fromarray(preview_rgb(cell), "RGB") for cell in cells]
    frame_ms = max(20, round(1000.0 / fps))
    gif_frames[0].save(
        out_dir / f"{action}.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=frame_ms,
        loop=0,
        optimize=False,
    )

    thumb_w = 256
    thumb_h = max(1, round(cells[0].shape[0] * thumb_w / cells[0].shape[1]))
    cols = 4
    rows = math.ceil(len(cells) / cols)
    contact = Image.new("RGB", (thumb_w * cols, (thumb_h + 24) * rows), "#20242a")
    for index, (source_index, cell) in enumerate(zip(indices, cells)):
        preview = Image.fromarray(preview_rgb(cell), "RGB").resize(
            (thumb_w, thumb_h), Image.Resampling.LANCZOS
        )
        row, col = divmod(index, cols)
        x = col * thumb_w
        y = row * (thumb_h + 24)
        contact.paste(preview, (x, y))
        draw = ImageDraw.Draw(contact)
        draw.text((x + 5, y + thumb_h + 4), f"f{source_index}", fill="white")
    contact.save(out_dir / f"{action}_contact.png")


def validate_cells(cells: list[np.ndarray]) -> dict[str, object]:
    bboxes = [alpha_bbox(cell) for cell in cells]
    alpha_counts = [int((cell[..., 3] > 10).sum()) for cell in cells]
    touch = [
        index
        for index, (x0, y0, x1, y1) in enumerate(bboxes)
        if x0 <= 2 or y0 <= 2 or x1 >= cells[index].shape[1] - 3 or y1 >= cells[index].shape[0] - 3
    ]
    feet = [bbox[3] for bbox in bboxes]
    return {
        "alphaPixelsMin": min(alpha_counts),
        "alphaPixelsMax": max(alpha_counts),
        "emptyFrames": [index for index, count in enumerate(alpha_counts) if count < 50],
        "touchingFrames": touch,
        "feetMin": min(feet),
        "feetMax": max(feet),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video1", type=Path, required=True)
    parser.add_argument("--video2", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    # Keep the 720p source close to native detail. Runtime displaySize performs
    # the final world-scale mapping; upscaling every source frame only bloats PNGs.
    parser.add_argument("--target-reference-height", type=int, default=256)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    videos: dict[str, tuple[list[np.ndarray], float]] = {
        "video1": decode_video(args.video1),
    }
    if args.video2:
        videos["video2"] = decode_video(args.video2)

    specs = [
        ActionSpec("idle", "video1", tuple(range(0, 48, 2)), 12.0, -1, "torso"),
        ActionSpec("walk", "video1", tuple(range(80, 100)), 24.0, -1, "torso"),
    ]
    if "video2" in videos:
        frames2, fps2 = videos["video2"]
        attack_end = min(len(frames2), round(2.0 * fps2))
        dying_start = min(len(frames2) - 1, round(3.0 * fps2))
        dying_end = min(len(frames2), round(5.0 * fps2))
        specs.extend(
            [
                ActionSpec(
                    "attack",
                    "video2",
                    visual_resample_indices(frames2, 0, attack_end, 18),
                    18.0 / 1.45,
                    -1,
                    "feet",
                ),
                ActionSpec(
                    "dying",
                    "video2",
                    visual_resample_indices(frames2, dying_start, dying_end, 24),
                    12.0,
                    0,
                    "bbox",
                ),
            ]
        )

    model = get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}

    def get_cutout(source: str, index: int) -> np.ndarray:
        key = (source, index)
        if key not in cache:
            frames, _ = videos[source]
            if index < 0 or index >= len(frames):
                raise RuntimeError(f"{source} frame {index} outside 0..{len(frames) - 1}")
            cache[key] = cutout_rgba(frames[index], model)
            print(f"[jaguar] cutout {source} f{index}", flush=True)
        return cache[key]

    source_scales: dict[str, float] = {}
    for source in videos:
        reference = get_cutout(source, 0)
        _, y0, _, y1 = alpha_bbox(reference)
        source_scales[source] = args.target_reference_height / (y1 - y0 + 1)

    report: dict[str, object] = {
        "targetReferenceHeight": args.target_reference_height,
        "sourceScales": source_scales,
        "actions": {},
    }
    for spec in specs:
        rgba_frames = [get_cutout(spec.source, index) for index in spec.indices]
        anchors = [horizontal_anchor(frame, spec.anchor) for frame in rgba_frames]
        scale = source_scales[spec.source]
        cell_w, cell_h = choose_cell(rgba_frames, anchors, scale)
        cells = [
            place_cell(frame, anchor, scale, cell_w, cell_h)
            for frame, anchor in zip(rgba_frames, anchors)
        ]
        sheet = compose_sheet(cells, 8)
        Image.fromarray(sheet, "RGBA").save(
            args.out_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        save_previews(spec.name, cells, spec.indices, spec.playback_fps, args.out_dir)
        validation = validate_cells(cells)
        report["actions"][spec.name] = {
            "source": spec.source,
            "sourceIndices": list(spec.indices),
            "frameCount": len(spec.indices),
            "frameWidth": cell_w,
            "frameHeight": cell_h,
            "cols": 8,
            "rows": math.ceil(len(cells) / 8),
            "frameRate": spec.playback_fps,
            "repeat": spec.repeat,
            "anchor": spec.anchor,
            "validation": validation,
        }
        print(
            f"[jaguar] {spec.name}: {len(cells)} frames, cell {cell_w}x{cell_h}, "
            f"fps {spec.playback_fps:.4f}, validation={validation}",
            flush=True,
        )

    with (args.out_dir / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
