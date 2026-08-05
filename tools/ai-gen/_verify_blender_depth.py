#!/usr/bin/env python3
"""校验 blender-depth-render.py 产出的深度图（一次性，可删）。"""
import os
import sys

from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
files = [
    "blender_defense_tower_h.png",
    "blender_defense_tower_v.png",
    "blender_cover_wall_h.png",
    "blender_cover_wall_v.png",
]
for name in files:
    p = os.path.join(HERE, "_depth_templates", name)
    im = Image.open(p)
    a = np.array(im)
    print(f"== {name}: size={im.size} mode={im.mode}")
    assert im.size == (1024, 1024), "尺寸不是 1024^2"
    ys, xs = np.nonzero(a)
    if len(ys) == 0:
        print("  FAIL: 全黑，无主体")
        continue
    # 背景抽查：四角
    corners = [a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]
    sub_max = int(a.max())
    bright = int((a > 200).sum())
    bottom = int(ys.max())
    top = int(ys.min())
    cx = float(xs.mean())
    width_px = int(xs.max() - xs.min())
    # 底行以下应全为 0
    below = int(a[bottom + 1:, :].max()) if bottom + 1 < 1024 else 0
    print(f"  四角背景值={corners} (须全0)")
    print(f"  主体: max={sub_max} (>200像素数={bright}) x均值={cx:.0f} 宽={width_px}px ({width_px/10.24:.0f}%)")
    print(f"  主体纵向: top={top} bottom={bottom} (要求870~890) 底行以下最大={below}")
    ok = (max(corners) == 0 and sub_max > 200 and 870 <= bottom <= 890 and below == 0)
    print("  PASS" if ok else "  FAIL")
