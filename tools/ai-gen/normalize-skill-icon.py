#!/usr/bin/env python3
"""Normalize a skill-icon PNG to the wuxianlunhui magic-skill-icon series baseline.

Baseline (fireball / meteor, measured from in-game assets):
  frame 1024x1024, content bbox aspect ~0.84, bbox area fill ~70%,
  center offset cx=0, cy=+29 (slightly below frame center).

The LoRA reproduces the style but the distilled 4-step pipeline drifts the
content scale (~52-64% fill). This script scales the visible content so its
bbox fills ~70% of the frame, keeps aspect ratio, and re-centers to cy=+29.
Output is a transparent 1024x1024 PNG (white background removed).
"""

import argparse
import os
import shutil
import sys

import numpy as np
from PIL import Image

TARGET_FILL = 0.70
TARGET_CY = 29
TARGET_CX = 0
FRAME = 1024
ALPHA_BG = 8  # same threshold as check-icon-sizes.py


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", help="source PNG (white background or opaque)")
    ap.add_argument("dst", help="output transparent normalized PNG")
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGBA")
    w, h = im.size
    a = np.asarray(im)[:, :, 3].astype(np.uint8)
    if (a > ALPHA_BG).sum() == 0:
        raise SystemExit("no visible content (alpha threshold)")

    # remove near-white background first
    rgb = np.asarray(im)[:, :, :3].astype(np.int16)
    white = (np.abs(rgb - 255).max(axis=2) <= 12) & (a > ALPHA_BG)
    alpha = np.asarray(im)[:, :, 3].copy()
    alpha[white] = 0
    cut = Image.fromarray(np.dstack((np.asarray(im)[:, :, :3], alpha)).astype(np.uint8))

    a2 = alpha
    ys, xs = np.where(a2 > ALPHA_BG)
    bw = xs.max() - xs.min() + 1
    bh = ys.max() - ys.min() + 1
    cur_fill = bw * bh / (w * h)

    # scale to target fill
    scale = (TARGET_FILL / cur_fill) ** 0.5
    nw = max(1, int(round(bw * scale)))
    nh = max(1, int(round(bh * scale)))
    scaled = cut.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).resize((nw, nh), Image.LANCZOS)

    # paste centered with cy offset
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    px = int(round(FRAME / 2 - nw / 2 + TARGET_CX))
    py = int(round(FRAME / 2 - nh / 2 + TARGET_CY))
    canvas.paste(scaled, (px, py), scaled)
    if os.path.exists(args.dst):
        shutil.copy2(args.dst, args.dst + ".bak")
        print(f"backed up existing -> {args.dst}.bak")
    canvas.save(args.dst)

    # report
    m = np.asarray(canvas)[:, :, 3]
    ys2, xs2 = np.where(m > ALPHA_BG)
    bw2, bh2 = xs2.max() - xs2.min() + 1, ys2.max() - ys2.min() + 1
    cx2 = int(round((xs2.min() + xs2.max()) / 2 - FRAME / 2))
    cy2 = int(round((ys2.min() + ys2.max()) / 2 - FRAME / 2))
    print(
        f"{os.path.basename(args.dst)}: bbox={bw2}x{bh2} aspect={round(bw2/bh2,2)} "
        f"fill%={round(bw2*bh2/FRAME/FRAME*100,1)} cx={cx2} cy={cy2}"
    )


if __name__ == "__main__":
    main()
