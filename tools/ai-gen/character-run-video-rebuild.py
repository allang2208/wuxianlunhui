#!/usr/bin/env python3
"""Rebuild one natural character-motion cycle from video into an RGBA sheet."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from rmbg_cutout import get_model, predict_alpha


def decode(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"no frames decoded from {path}")
    return frames, fps


def keep_subject(alpha: np.ndarray) -> np.ndarray:
    mask = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet found no foreground")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 32, ly - 32, lx + lw + 32, ly + lh + 32)
    keep = labels == largest
    for label in range(1, count):
        if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 24:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if x < expanded[2] and x + w > expanded[0] and y < expanded[3] and y + h > expanded[1]:
            keep |= labels == label
    clean = alpha.copy()
    clean[~keep] = 0
    clean[clean < 6] = 0
    return clean


def cutout(rgb: np.ndarray, model) -> np.ndarray:
    alpha = np.squeeze(np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB"))))
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = keep_subject(np.clip(alpha, 0, 255).astype(np.uint8))
    clean_rgb = rgb.astype(np.float32)
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        af = a[semi, None]
        clean_rgb[semi] = np.clip((clean_rgb[semi] - (1.0 - af) * 255.0) / af, 0, 255)
    clean_rgb[a <= 0.02] = 0
    return np.dstack([clean_rgb.astype(np.uint8), alpha])


def bbox(rgba: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not len(xs):
        raise RuntimeError("empty cutout")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def torso_anchor(rgba: np.ndarray) -> float:
    x0, y0, x1, y1 = bbox(rgba)
    height = y1 - y0 + 1
    top = y0 + round(height * 0.28)
    bottom = y0 + round(height * 0.62)
    ys, xs = np.where(rgba[top:bottom + 1, :, 3] > 32)
    return float(np.median(xs)) if len(xs) else (x0 + x1) / 2.0


def lower_body_anchor(rgba: np.ndarray) -> float:
    """Return the horizontal center of the planted legs, excluding sword/cape."""
    x0, y0, x1, y1 = bbox(rgba)
    height = y1 - y0 + 1
    torso_x = torso_anchor(rgba)
    top = y0 + round(height * 0.66)
    radius = max(8, round(height * 0.18))
    left = max(x0, round(torso_x) - radius)
    right = min(x1, round(torso_x) + radius)
    ys, xs = np.where(rgba[top:y1 + 1, left:right + 1, 3] > 32)
    return float(np.median(xs + left)) if len(xs) else torso_x


def horizontal_anchor(rgba: np.ndarray, mode: str) -> float:
    return lower_body_anchor(rgba) if mode == "lower-body" else torso_anchor(rgba)


def place(rgba: np.ndarray, scale: float, cell: int, feet_y: int, anchor_mode: str) -> np.ndarray:
    x0, y0, x1, y1 = bbox(rgba)
    anchor = horizontal_anchor(rgba, anchor_mode)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS))
    local_anchor = (anchor - x0) * scale
    ox = round(cell / 2 - local_anchor)
    oy = feet_y - height
    if ox < 2 or oy < 2 or ox + width > cell - 2 or oy + height > cell - 2:
        raise RuntimeError(f"placement clips: {width}x{height} at ({ox},{oy}) in {cell}x{cell}")
    out = np.zeros((cell, cell, 4), np.uint8)
    out[oy:oy + height, ox:ox + width] = resized
    if anchor_mode == "lower-body":
        correction = round(cell / 2 - lower_body_anchor(out))
        if correction:
            shifted = np.zeros_like(out)
            if correction > 0:
                shifted[:, correction:] = out[:, :cell - correction]
            else:
                shifted[:, :cell + correction] = out[:, -correction:]
            out = shifted
    return out


def frame_delta(left: np.ndarray, right: np.ndarray) -> float:
    union = (left[..., 3] > 16) | (right[..., 3] > 16)
    if not union.any():
        return 0.0
    gray_left = cv2.cvtColor(left[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray_right = cv2.cvtColor(right[..., :3], cv2.COLOR_RGB2GRAY).astype(np.float32)
    return float(np.abs(gray_left - gray_right)[union].mean())


def mask_iou(left: np.ndarray, right: np.ndarray, top: int = 0) -> float:
    lm = left[top:, :, 3] > 16
    rm = right[top:, :, 3] > 16
    union = np.logical_or(lm, rm).sum()
    return float(np.logical_and(lm, rm).sum() / union) if union else 1.0


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    bg = np.where(((xx // 24 + yy // 24) % 2)[..., None], 56, 82).astype(np.float32)
    bg = np.repeat(bg, 3, axis=2)
    a = cell[..., 3:4].astype(np.float32) / 255.0
    return Image.fromarray(np.clip(cell[..., :3] * a + bg * (1.0 - a), 0, 255).astype(np.uint8), "RGB")


def save_contact(cells: list[np.ndarray], indices: list[int], out: Path) -> None:
    thumb = 256
    cols = 5
    rows = math.ceil(len(cells) / cols)
    image = Image.new("RGB", (cols * thumb, rows * (thumb + 24)), "#20242a")
    draw = ImageDraw.Draw(image)
    for i, (cell, source_index) in enumerate(zip(cells, indices)):
        preview = checker(cell).resize((thumb, thumb), Image.Resampling.LANCZOS)
        x = (i % cols) * thumb
        y = (i // cols) * (thumb + 24)
        image.paste(preview, (x, y))
        draw.text((x + 5, y + thumb + 4), f"sheet {i} / source f{source_index}", fill="white")
    image.save(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--endpoint", type=int, required=True, help="same-phase duplicate endpoint; excluded")
    parser.add_argument("--step", type=int, default=1, help="keep every Nth source frame")
    parser.add_argument("--scale-frame", type=int, default=0)
    parser.add_argument("--target-height", type=int, default=461)
    parser.add_argument("--cell", type=int, default=640)
    parser.add_argument("--feet-y", type=int, default=600)
    parser.add_argument("--cols", type=int, default=5)
    parser.add_argument(
        "--horizontal-anchor",
        choices=("torso", "lower-body"),
        default="torso",
        help="lock each frame by torso center or planted lower-body center",
    )
    parser.add_argument("--stem", default="running", help="output basename, for example running or walking")
    args = parser.parse_args()

    frames, fps = decode(args.video)
    if not (0 <= args.scale_frame < len(frames)):
        raise RuntimeError("scale frame outside video")
    if not (0 <= args.start < args.endpoint < len(frames)):
        raise RuntimeError("invalid cycle range")
    if args.step < 1:
        raise RuntimeError("step must be at least 1")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    included = list(range(args.start, args.endpoint, args.step))
    required = sorted(set([args.scale_frame, args.endpoint, *included]))
    model = get_model()
    cutouts: dict[int, np.ndarray] = {}
    for index in required:
        cutouts[index] = cutout(frames[index], model)
        print(f"[motion-rebuild] BiRefNet f{index}", flush=True)

    _, sy0, _, sy1 = bbox(cutouts[args.scale_frame])
    scale = args.target_height / (sy1 - sy0 + 1)
    cells = [place(cutouts[index], scale, args.cell, args.feet_y, args.horizontal_anchor) for index in included]
    endpoint_cell = place(cutouts[args.endpoint], scale, args.cell, args.feet_y, args.horizontal_anchor)

    rows = math.ceil(len(cells) / args.cols)
    sheet = np.zeros((rows * args.cell, args.cols * args.cell, 4), np.uint8)
    for i, cell in enumerate(cells):
        row, col = divmod(i, args.cols)
        sheet[row * args.cell:(row + 1) * args.cell, col * args.cell:(col + 1) * args.cell] = cell
    Image.fromarray(sheet, "RGBA").save(args.out_dir / f"{args.stem}.png", optimize=True, compress_level=9)

    gif_frames = [checker(cell) for cell in cells]
    playback = gif_frames * 3
    output_fps = fps / args.step
    frame_ms = max(20, round(1000 / output_fps))
    playback[0].save(args.out_dir / f"{args.stem}.gif", save_all=True, append_images=playback[1:],
                     duration=frame_ms, loop=0, optimize=False)
    save_contact(cells, included, args.out_dir / f"{args.stem}_contact.png")

    bboxes = [bbox(cell) for cell in cells]
    alpha_counts = [int((cell[..., 3] > 10).sum()) for cell in cells]
    adjacent = [frame_delta(left, right) for left, right in zip(cells, cells[1:])]
    seam = frame_delta(cells[-1], cells[0])
    adjacent_median = float(np.median(adjacent))
    torso_offsets = [torso_anchor(cell) - args.cell / 2 for cell in cells]
    lower_body_offsets = [lower_body_anchor(cell) - args.cell / 2 for cell in cells]
    report = {
        "source": str(args.video),
        "fps": fps,
        "sourceFrames": len(frames),
        "cycleStart": args.start,
        "duplicateEndpoint": args.endpoint,
        "includedSourceFrames": included,
        "frameCount": len(cells),
        "frameWidth": args.cell,
        "frameHeight": args.cell,
        "cols": args.cols,
        "rows": rows,
        "frameRate": output_fps,
        "sourceFrameStep": args.step,
        "scaleFrame": args.scale_frame,
        "fixedScale": scale,
        "horizontalAnchor": args.horizontal_anchor,
        "validation": {
            "emptyFrames": [i for i, count in enumerate(alpha_counts) if count < 50],
            "touchingFrames": [i for i, (x0, y0, x1, y1) in enumerate(bboxes)
                               if x0 <= 2 or y0 <= 2 or x1 >= args.cell - 3 or y1 >= args.cell - 3],
            "feetMin": min(box[3] for box in bboxes),
            "feetMax": max(box[3] for box in bboxes),
            "torsoOffsetMin": min(torso_offsets),
            "torsoOffsetMax": max(torso_offsets),
            "torsoOffsetSpan": max(torso_offsets) - min(torso_offsets),
            "lowerBodyOffsetMin": min(lower_body_offsets),
            "lowerBodyOffsetMax": max(lower_body_offsets),
            "lowerBodyOffsetSpan": max(lower_body_offsets) - min(lower_body_offsets),
            "firstEndpointFullIoU": mask_iou(cells[0], endpoint_cell),
            "firstEndpointLegIoU": mask_iou(cells[0], endpoint_cell, round(args.cell * 0.67)),
            "adjacentDeltaMedian": adjacent_median,
            "adjacentDeltaMin": min(adjacent),
            "adjacentDeltaMax": max(adjacent),
            "seamDelta": seam,
            "seamRatio": seam / max(0.001, adjacent_median),
        },
    }
    (args.out_dir / f"{args.stem}_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
