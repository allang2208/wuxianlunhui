#!/usr/bin/env python3
"""Rebuild one grounded or source-space one-shot character action into RGBA frames."""

from __future__ import annotations

import argparse
import json
import math
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
COMMON = runpy.run_path(str(SCRIPT_DIR / "character-run-video-rebuild.py"))
decode = COMMON["decode"]
cutout = COMMON["cutout"]
bbox = COMMON["bbox"]
torso_anchor = COMMON["torso_anchor"]
lower_body_anchor = COMMON["lower_body_anchor"]
checker = COMMON["checker"]
frame_delta = COMMON["frame_delta"]
get_model = COMMON["get_model"]


def anchor_x(rgba: np.ndarray, mode: str) -> float:
    return lower_body_anchor(rgba) if mode == "lower-body" else torso_anchor(rgba)


def resize_crop(rgba: np.ndarray, scale: float) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    x0, y0, x1, y1 = bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    )
    return resized, (x0, y0, x1, y1)


def place_grounded(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    frame_height: int,
    ground_y: int,
    mode: str,
) -> np.ndarray:
    resized, (x0, _y0, _x1, _y1) = resize_crop(rgba, scale)
    local_anchor = (anchor_x(rgba, mode) - x0) * scale
    ox = round(frame_width / 2 - local_anchor)
    oy = ground_y - resized.shape[0]
    return paste_checked(resized, ox, oy, frame_width, frame_height)


def place_source_space(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    frame_height: int,
    ground_y: int,
    source_anchor_x: float,
    source_ground_y: float,
) -> np.ndarray:
    resized, (x0, y0, _x1, _y1) = resize_crop(rgba, scale)
    ox = round(frame_width / 2 + (x0 - source_anchor_x) * scale)
    oy = round(ground_y + (y0 - source_ground_y) * scale)
    return paste_checked(resized, ox, oy, frame_width, frame_height)


def paste_checked(
    resized: np.ndarray, ox: int, oy: int, frame_width: int, frame_height: int
) -> np.ndarray:
    height, width = resized.shape[:2]
    if ox < 2 or oy < 2 or ox + width > frame_width - 2 or oy + height > frame_height - 2:
        raise RuntimeError(
            f"placement clips: {width}x{height} at ({ox},{oy}) in {frame_width}x{frame_height}"
        )
    out = np.zeros((frame_height, frame_width, 4), np.uint8)
    out[oy:oy + height, ox:ox + width] = resized
    return out


def save_contact(cells: list[np.ndarray], indices: list[int], out: Path) -> None:
    thumb_w = 256
    thumb_h = max(1, round(cells[0].shape[0] * thumb_w / cells[0].shape[1]))
    cols = 5
    rows = math.ceil(len(cells) / cols)
    canvas = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 24)), "#20242a")
    draw = ImageDraw.Draw(canvas)
    for i, (cell, source_index) in enumerate(zip(cells, indices)):
        preview = checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (i % cols) * thumb_w
        y = (i // cols) * (thumb_h + 24)
        canvas.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 4), f"sheet {i} / source f{source_index}", fill="white")
    canvas.save(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end-exclusive", type=int, required=True)
    parser.add_argument("--step", type=int, default=4)
    parser.add_argument("--scale-frame", type=int, required=True)
    parser.add_argument("--target-height", type=int, default=374)
    parser.add_argument("--frame-width", type=int, default=640)
    parser.add_argument("--frame-height", type=int, default=640)
    parser.add_argument("--ground-y", type=int, default=600)
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--anchor-mode", choices=("lower-body", "torso", "source"), default="lower-body")
    parser.add_argument("--stem", required=True)
    args = parser.parse_args()

    frames, fps = decode(args.video)
    if not (0 <= args.start < args.end_exclusive <= len(frames)):
        raise RuntimeError(f"invalid range {args.start}:{args.end_exclusive} for {len(frames)} frames")
    if not (0 <= args.scale_frame < len(frames)) or args.step < 1:
        raise RuntimeError("invalid scale frame or step")
    if not (2 < args.ground_y < args.frame_height - 2):
        raise RuntimeError("ground-y must remain inside the frame")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    included = list(range(args.start, args.end_exclusive, args.step))
    required = sorted(set([args.scale_frame, *included]))
    model = get_model()
    cutouts: dict[int, np.ndarray] = {}
    for index in required:
        cutouts[index] = cutout(frames[index], model)
        print(f"[one-shot-rebuild] BiRefNet f{index}", flush=True)

    ref = cutouts[args.scale_frame]
    _rx0, ry0, _rx1, ry1 = bbox(ref)
    scale = args.target_height / (ry1 - ry0 + 1)
    source_anchor = lower_body_anchor(ref)
    source_ground = float(ry1)
    cells: list[np.ndarray] = []
    for index in included:
        rgba = cutouts[index]
        if args.anchor_mode == "source":
            cell = place_source_space(
                rgba, scale, args.frame_width, args.frame_height, args.ground_y,
                source_anchor, source_ground,
            )
        else:
            cell = place_grounded(
                rgba, scale, args.frame_width, args.frame_height, args.ground_y,
                args.anchor_mode,
            )
        cells.append(cell)

    rows = math.ceil(len(cells) / args.cols)
    sheet = np.zeros((rows * args.frame_height, args.cols * args.frame_width, 4), np.uint8)
    for i, cell in enumerate(cells):
        row, col = divmod(i, args.cols)
        y = row * args.frame_height
        x = col * args.frame_width
        sheet[y:y + args.frame_height, x:x + args.frame_width] = cell
    Image.fromarray(sheet, "RGBA").save(
        args.out_dir / f"{args.stem}.png", optimize=True, compress_level=9
    )

    output_fps = fps / args.step
    gif_frames = [checker(cell) for cell in cells]
    frame_ms = max(20, round(1000 / output_fps))
    gif_frames[0].save(
        args.out_dir / f"{args.stem}.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=frame_ms,
        loop=0,
        optimize=False,
    )
    save_contact(cells, included, args.out_dir / f"{args.stem}_contact.png")

    bboxes = [bbox(cell) for cell in cells]
    alpha_counts = [int((cell[..., 3] > 10).sum()) for cell in cells]
    adjacent = [frame_delta(left, right) for left, right in zip(cells, cells[1:])]
    report = {
        "source": str(args.video),
        "sourceFps": fps,
        "sourceFrames": len(frames),
        "window": [args.start, args.end_exclusive],
        "includedSourceFrames": included,
        "frameCount": len(cells),
        "frameWidth": args.frame_width,
        "frameHeight": args.frame_height,
        "cols": args.cols,
        "rows": rows,
        "frameRate": output_fps,
        "sourceFrameStep": args.step,
        "scaleFrame": args.scale_frame,
        "fixedScale": scale,
        "anchorMode": args.anchor_mode,
        "repeat": 0,
        "validation": {
            "emptyFrames": [i for i, count in enumerate(alpha_counts) if count < 50],
            "touchingFrames": [
                i for i, (x0, y0, x1, y1) in enumerate(bboxes)
                if x0 <= 2 or y0 <= 2 or x1 >= args.frame_width - 3 or y1 >= args.frame_height - 3
            ],
            "alphaBottomMin": min(box[3] for box in bboxes),
            "alphaBottomMax": max(box[3] for box in bboxes),
            "adjacentDeltaMin": min(adjacent) if adjacent else 0.0,
            "adjacentDeltaMedian": float(np.median(adjacent)) if adjacent else 0.0,
            "adjacentDeltaMax": max(adjacent) if adjacent else 0.0,
        },
    }
    (args.out_dir / f"{args.stem}_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
