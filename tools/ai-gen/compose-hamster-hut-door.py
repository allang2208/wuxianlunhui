#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""仓鼠小屋（工厂关门版）16 帧开关门精灵表合成（2026-08-15）。

输入：render-factory-real.py --slide n/15 产出的 frame_00..15.png（2048×2048）
输出：assets/terrain/hamster_hut_door.png（4×4 精灵表，稳定裁剪框）
打印：cell 尺寸（BootScene spritesheet 参数用）
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES_DIR = os.path.join(ROOT, "tools", "ai-gen", "factory-out", "door")
DST = os.path.join(ROOT, "assets", "terrain", "hamster_hut_door.png")
FRAMES = 16
CELL_W = 512


def main():
    frames = []
    for n in range(FRAMES):
        p = os.path.join(FRAMES_DIR, f"frame_{n:02d}.png")
        frames.append(np.array(Image.open(p).convert("RGBA")))
    # 稳定内容框：以关闭帧（frame 0）为准，全部帧共用同一裁剪框
    a0 = frames[0]
    ys, xs = np.nonzero(a0[..., 3] > 8)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    print(f"content bbox: x {x0}..{x1} (w {cw}), y {y0}..{y1} (h {ch})")
    cell_h = round(CELL_W * ch / cw)
    print(f"cell: {CELL_W}x{cell_h}")
    cells = []
    for a in frames:
        crop = Image.fromarray(a[y0:y1 + 1, x0:x1 + 1])
        cells.append(np.array(crop.resize((CELL_W, cell_h), Image.LANCZOS)))
    sheet = Image.new("RGBA", (CELL_W * 4, cell_h * 4), (0, 0, 0, 0))
    for n, c in enumerate(cells):
        sheet.paste(Image.fromarray(c), ((n % 4) * CELL_W, (n // 4) * cell_h))
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    sheet.save(DST)
    print(f"saved {DST} ({sheet.size[0]}x{sheet.size[1]})")


if __name__ == "__main__":
    main()
