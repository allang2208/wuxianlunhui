#!/usr/bin/env python3
"""Report content bbox margins from canvas edges for icons."""

import os

import numpy as np
from PIL import Image

DST = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"
FILES = ["贤者项链.png", "磐心项链.png", "蚀月法袍.png", "蚀月法帽.png"]

for f in FILES:
    p = os.path.join(DST, f)
    if not os.path.exists(p):
        print(f, "MISSING")
        continue
    a = np.asarray(Image.open(p))
    alpha = a[..., 3] > 8
    ys, xs = np.where(alpha)
    if len(xs) == 0:
        print(f, "EMPTY")
        continue
    h, w = alpha.shape
    margins = {
        "L": int(xs.min()),
        "R": int(w - xs.max() - 1),
        "T": int(ys.min()),
        "B": int(h - ys.max() - 1),
    }
    print(f"{f}: margins={margins} min_margin={min(margins.values())}px")
