#!/usr/bin/env python3
"""Inset a subject on its source canvas before image-to-video generation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def parse_hex(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6:
        raise argparse.ArgumentTypeError("background must be #RRGGBB")
    return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))


def subject_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int]:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    if int((alpha < 250).sum()) > alpha.size * 0.01:
        mask = alpha > threshold
    else:
        rgb = rgba[..., :3].astype(np.int16)
        corners = np.concatenate([
            rgb[:32, :32].reshape(-1, 3),
            rgb[:32, -32:].reshape(-1, 3),
            rgb[-32:, :32].reshape(-1, 3),
            rgb[-32:, -32:].reshape(-1, 3),
        ])
        background = np.median(corners, axis=0)
        mask = np.sqrt(((rgb - background) ** 2).sum(axis=2)) > threshold
    ys, xs = np.where(mask)
    if not len(xs):
        raise ValueError("no subject pixels detected")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--subject-width", type=float, default=0.50)
    parser.add_argument("--anchor-x", type=float, default=0.36)
    parser.add_argument("--foot-y", type=float, default=0.72)
    parser.add_argument("--threshold", type=int, default=24)
    parser.add_argument("--background", type=parse_hex, default=(255, 255, 255))
    parser.add_argument("--canvas-width", type=int, default=0,
                        help="output canvas width; defaults to source width")
    parser.add_argument("--canvas-height", type=int, default=0,
                        help="output canvas height; defaults to source height")
    args = parser.parse_args()

    if not 0.1 <= args.subject_width <= 0.9:
        raise ValueError("subject-width must be within 0.1..0.9")
    if not 0.1 <= args.anchor_x <= 0.9 or not 0.1 <= args.foot_y <= 0.95:
        raise ValueError("anchor-x/foot-y are outside the supported canvas range")

    source = Image.open(args.src).convert("RGBA")
    bbox = subject_bbox(source, args.threshold)
    subject = source.crop(bbox)
    canvas_w = args.canvas_width or source.width
    canvas_h = args.canvas_height or source.height
    if canvas_w <= 0 or canvas_h <= 0:
        raise ValueError("canvas dimensions must be positive")
    target_w = max(1, round(canvas_w * args.subject_width))
    scale = target_w / subject.width
    target_h = max(1, round(subject.height * scale))
    if target_h > round(canvas_h * 0.72):
        scale = canvas_h * 0.72 / subject.height
        target_w = max(1, round(subject.width * scale))
        target_h = max(1, round(subject.height * scale))
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)

    dst_x = round(canvas_w * args.anchor_x - target_w / 2)
    dst_y = round(canvas_h * args.foot_y - target_h)
    dst_x = max(0, min(canvas_w - target_w, dst_x))
    dst_y = max(0, min(canvas_h - target_h, dst_y))
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (*args.background, 255))
    canvas.alpha_composite(subject, (dst_x, dst_y))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(args.out)

    print(json.dumps({
        "source": str(args.src),
        "output": str(args.out),
        "sourceBbox": bbox,
        "sourceCanvas": list(source.size),
        "canvas": [canvas_w, canvas_h],
        "outputBbox": [dst_x, dst_y, dst_x + target_w, dst_y + target_h],
        "subjectWidthRatio": target_w / canvas_w,
        "margins": {
            "left": dst_x,
            "right": canvas_w - dst_x - target_w,
            "top": dst_y,
            "bottom": canvas_h - dst_y - target_h,
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
