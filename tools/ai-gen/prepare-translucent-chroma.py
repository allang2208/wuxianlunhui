#!/usr/bin/env python3
"""Prepare a translucent white-background subject for solid-key video generation.

The ordinary BiRefNet mask is kept as foreground support, while pale material
(insect wings, glass, gauze) receives a soft alpha derived from its distance to
the known white plate.  The result is saved both as RGBA and composited over a
solid chroma background for RGB-only image-to-video models.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def parse_hex(value: str) -> np.ndarray:
    value = value.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError("color must be #RRGGBB")
    return np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="white-background RGB source")
    ap.add_argument("--mask", required=True, help="BiRefNet grayscale support mask")
    ap.add_argument("--out-rgba", required=True)
    ap.add_argument("--out-chroma", required=True)
    ap.add_argument("--bg-color", default="#0000FF")
    ap.add_argument("--canvas", default="1344x768")
    ap.add_argument("--fill", type=float, default=0.82,
                    help="maximum fraction of output width/height occupied by the subject")
    args = ap.parse_args()

    rgb = np.array(Image.open(args.src).convert("RGB"), dtype=np.float32)
    support = np.array(Image.open(args.mask).convert("L"), dtype=np.float32)
    if support.shape != rgb.shape[:2]:
        raise SystemExit("mask and source dimensions differ")

    # On a white plate, pale translucent material stays close to white while
    # opaque dark material is far away.  Preserve this continuous relationship
    # instead of turning the BiRefNet silhouette into a hard binary mask.
    delta = np.max(255.0 - rgb, axis=2)
    soft = np.clip((delta - 1.5) / 92.0, 0.0, 1.0) * 255.0
    luminance = rgb.mean(axis=2)
    alpha = np.minimum(soft, support)
    alpha[luminance < 185.0] = support[luminance < 185.0]
    membrane = (support > 96.0) & (delta > 2.0)
    alpha[membrane] = np.maximum(alpha[membrane], 14.0)
    alpha[support < 8.0] = 0.0
    alpha[alpha > 238.0] = 255.0
    alpha[alpha < 4.0] = 0.0
    alpha = alpha.astype(np.uint8)

    ys, xs = np.where(alpha > 3)
    if not len(xs):
        raise SystemExit("empty alpha result")
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop_rgb = rgb[y0:y1 + 1, x0:x1 + 1].astype(np.uint8)
    crop_alpha = alpha[y0:y1 + 1, x0:x1 + 1]

    out_w, out_h = (int(v) for v in args.canvas.lower().split("x", 1))
    scale = min(out_w * args.fill / crop_rgb.shape[1], out_h * args.fill / crop_rgb.shape[0])
    new_w = max(1, round(crop_rgb.shape[1] * scale))
    new_h = max(1, round(crop_rgb.shape[0] * scale))
    rgb_im = Image.fromarray(crop_rgb, "RGB").resize((new_w, new_h), Image.Resampling.LANCZOS)
    alpha_im = Image.fromarray(crop_alpha, "L").resize((new_w, new_h), Image.Resampling.LANCZOS)

    rgba_canvas = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    ox = (out_w - new_w) // 2
    oy = (out_h - new_h) // 2
    rgba_canvas.paste(rgb_im.convert("RGBA"), (ox, oy), alpha_im)

    bg = parse_hex(args.bg_color).astype(np.uint8)
    chroma = Image.new("RGB", (out_w, out_h), tuple(int(v) for v in bg))
    chroma.paste(rgba_canvas, (0, 0), rgba_canvas.getchannel("A"))

    Path(args.out_rgba).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_chroma).parent.mkdir(parents=True, exist_ok=True)
    rgba_canvas.save(args.out_rgba)
    chroma.save(args.out_chroma)
    semi = int(((np.array(rgba_canvas.getchannel("A")) > 3) &
                (np.array(rgba_canvas.getchannel("A")) < 239)).sum())
    print(f"prepared {out_w}x{out_h}; subject={new_w}x{new_h}; semi_alpha_pixels={semi}")


if __name__ == "__main__":
    main()
