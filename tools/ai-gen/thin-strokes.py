#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""细线化（线宽统一）：H3 每代际会系统性加粗描边（实测 idle 2.7px / 一段 3.2 /
二段 4.0 / 三段 4.3px——首帧链路每过一代 +0.4px）。

距离变换层级收缩：暗笔画(lum<110 & alpha>128) 收缩 T=1.2px，软边带 (T-1,T] 混白 55%
抗锯齿；只动 RGB 不动 alpha（轮廓不变 → 跟手标定/贴附率不受影响）。

用法（ComfyUI venv python）：
  python tools/ai-gen/thin-strokes.py assets/player/attack_sword_2.png [更多 sheet...]
"""
import sys
import numpy as np
from PIL import Image
import cv2

T = 1.2

def thin(arr):
    out = arr.copy().astype(np.float32)
    a = arr[:, :, 3]
    lum = arr[:, :, :3].astype(np.float32).mean(axis=2)
    dark = ((lum < 110) & (a > 128)).astype(np.uint8)
    if dark.sum() == 0:
        return arr
    dt = cv2.distanceTransform(dark, cv2.DIST_L2, 3)
    keep = dt > T
    band = (dt > T - 1) & (dt <= T)
    gone = (dark > 0) & ~keep & ~band
    rgb = out[:, :, :3]
    for c in range(3):
        ch = rgb[:, :, c]
        ch[band] = ch[band] * 0.45 + 255 * 0.55
        ch[gone] = 255
    out[:, :, :3] = rgb
    return out.astype(np.uint8)

def width_stat(arr):
    lum = arr[:, :, :3].astype(np.float32).mean(axis=2)
    a = arr[:, :, 3]
    dark = ((lum < 110) & (a > 128)).astype(np.uint8)
    n = int(dark.sum())
    if n == 0: return 0, 0
    dt = cv2.distanceTransform(dark, cv2.DIST_L2, 3)
    vals = dt[dark > 0]
    return n, vals.mean() * 2

for path in sys.argv[1:]:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    n0, w0 = width_stat(arr)
    alpha_before = arr[:, :, 3].copy()
    out = thin(arr)
    assert np.array_equal(out[:, :, 3], alpha_before), "alpha 被改动!"
    n1, w1 = width_stat(out)
    Image.fromarray(out).save(path)
    print(f"{path.split('/')[-1]}: 暗笔画px {n0}→{n1}, 核心半径均值 {w0:.2f}→{w1:.2f}")
