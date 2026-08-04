#!/usr/bin/env python3
"""Quantify 蚀月 icon compliance: bbox ratio, aspect ratio, center offset."""

import os

import numpy as np
from PIL import Image

FOLDER = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"
FILES = ["流云轻盔.png", "流云轻甲.png", "流云轻靴.png",
         "蚀月法帽.png", "蚀月法袍.png", "蚀月长靴.png",
         "镇岳重盔.png", "镇岳重甲.png", "镇岳重靴.png",
         "星陨之戒.png", "不息腰带.png", "磐心项链.png"]

for f in FILES:
    im = Image.open(os.path.join(FOLDER, f))
    a = np.asarray(im)
    alpha = a[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        print(f, "EMPTY")
        continue
    w = xs.max() - xs.min() + 1
    h = ys.max() - ys.min() + 1
    ar = w / h
    cx = (xs.min() + xs.max()) / 2
    cy = (ys.min() + ys.max()) / 2
    print(f"{f}: size={im.size} bbox={w}x{h} ar={ar:.3f} "
          f"center=({cx:.1f},{cy:.1f}) longest_ratio={max(w, h) / 1536:.3f}")
