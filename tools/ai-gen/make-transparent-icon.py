#!/usr/bin/env python3
"""Cut a plain-white-background generated icon into a transparent RGBA game icon.

Usage:
    python make-transparent-icon.py <src.png> <dst.png>

Method (mirrors project conventions in cutout-icons.py):
  1) flood-fill near-white background from the image borders
  2) keep only the largest connected foreground component
  3) feather the alpha edge
  4) decontaminate edge colors against the white background (no white halo)
"""

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

WHITE_TOL = 30
FEATHER = 1.0


def cutout(src, dst):
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img).astype(np.int16)
    n, m, _ = rgb.shape

    near_white = (np.abs(rgb - np.array([250, 250, 250], dtype=np.int16)).sum(axis=2) <= WHITE_TOL)
    labels, nlabels = ndimage.label(near_white)
    bg_labels = set()
    border_px = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    for lab in border_px:
        if lab != 0:
            bg_labels.add(lab)
    background = np.zeros(near_white.shape, dtype=bool)
    for lab in bg_labels:
        background |= labels == lab

    foreground = ~background
    flabels, nf = ndimage.label(foreground)
    if nf == 0:
        raise RuntimeError(f"{src}: no foreground found")
    sizes = ndimage.sum(foreground, flabels, range(1, nf + 1))
    mask = flabels == (1 + int(np.argmax(sizes)))
    mask = ndimage.binary_erosion(mask, iterations=1)

    alpha_f = ndimage.gaussian_filter(mask.astype(np.float32), sigma=FEATHER)
    alpha = np.clip(alpha_f * 255, 0, 255).astype(np.uint8)
    a_n = alpha_f[..., None].astype(np.float32)
    white = np.array([250.0, 250.0, 250.0], dtype=np.float32)
    decont = (rgb.astype(np.float32) - (1.0 - a_n) * white) / np.maximum(a_n, 1e-3)
    decont = np.clip(decont, 0, 255).astype(np.uint8)

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    Image.fromarray(np.dstack([decont, alpha]).astype(np.uint8), "RGBA").save(dst)

    opaque = float((alpha > 200).sum()) / (n * m)
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return {"opaque": round(opaque * 100, 1), "bbox": None}
    w = xs.max() - xs.min()
    h = ys.max() - ys.min()
    return {
        "opaque": round(opaque * 100, 1),
        "bbox": {"w": int(w), "h": int(h),
                 "cx": int(round((xs.min() + xs.max()) / 2 - n / 2)),
                 "cy": int(round((ys.min() + ys.max()) / 2 - m / 2))},
    }


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    stats = cutout(src, dst)
    print(f"{dst}: opaque%={stats['opaque']} bbox={stats['bbox']}")


if __name__ == "__main__":
    main()
