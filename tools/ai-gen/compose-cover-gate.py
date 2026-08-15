#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D 级铁栅栏滑动门 16 帧合成 + 几何标定（2026-08-15）。

输入：render-cover-gate.py 产出的 frame_00..15.png（2048×2048，slide = n/15）
输出：
  - assets/terrain/cover_gate_D.png     4×4 spritesheet（CELL_W=640 方格）
  - 标定打印（face 线端点 / gateX / wallH / slope），供 ISO_WALL_GEO / CoverGate 使用
"""
import json
import math
import os
import sys

from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CELL_W = 640
FRAMES = 16


def load_frame(frames_dir, n):
    return np.array(Image.open(os.path.join(frames_dir, f"frame_{n:02d}.png")).convert("RGBA"))


def main():
    args = [a for a in sys.argv[1:]]
    grade = "D"
    frames_dir = None
    dst = None
    if len(args) >= 1:
        grade = args[0]
    if len(args) >= 2:
        frames_dir = args[1]
    if len(args) >= 3:
        dst = args[2]
    frames_dir = frames_dir or rf"Y:\工作\无尽轮回\scratch\world122\gate_{grade.lower()}"
    dst = dst or os.path.join(ROOT, "assets", "terrain", f"cover_gate_{grade}.png")
    frames = [load_frame(frames_dir, n) for n in range(FRAMES)]
    # 稳定内容框：以关闭帧（frame 0）为准，全部帧用同一裁剪框
    a0 = frames[0]
    ys, xs = np.nonzero(a0[..., 3] > 8)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    print(f"content bbox: x {x0}..{x1} (w {cw}), y {y0}..{y1} (h {ch})")
    sc = CELL_W / cw
    cell_h = round(ch * sc)
    print(f"cell: {CELL_W}x{cell_h} (scale {sc:.4f})")
    cells = []
    for n, a in enumerate(frames):
        crop = a[y0:y1 + 1, x0:x1 + 1]
        im = Image.fromarray(crop).resize((CELL_W, cell_h), Image.LANCZOS)
        cells.append(np.array(im))
    # 打包 4×4
    sheet = Image.new("RGBA", (CELL_W * 4, cell_h * 4), (0, 0, 0, 0))
    for n, c in enumerate(cells):
        sheet.paste(Image.fromarray(c), ((n % 4) * CELL_W, (n // 4) * cell_h))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sheet.save(dst)
    print(f"saved {dst} ({sheet.size[0]}x{sheet.size[1]})")

    # ---- 几何标定（关闭帧）----
    f0 = cells[0]
    # 底边线：中段列底部 alpha 拟合
    bot = np.full(CELL_W, -1.0)
    for x in range(CELL_W):
        col = np.nonzero(f0[:, x, 3] > 20)[0]
        if len(col):
            bot[x] = col.max()
    m = np.nonzero(bot >= 0)[0]
    sel = m[(m >= CELL_W * 0.08) & (m <= CELL_W * 0.92)]
    s, b = np.polyfit(sel, bot[sel], 1)
    A = (int(sel.min()), int(round(b + s * sel.min())))
    B = (int(sel.max()), int(round(b + s * sel.max())))
    print(f"bottom slope {s:.4f}  tex A{A} B{B}  len {math.hypot(B[0]-A[0], B[1]-A[1]):.1f}")
    # 墙高：底边线到内容顶的中位数
    top = np.full(CELL_W, -1.0)
    for x in range(CELL_W):
        col = np.nonzero(f0[:, x, 3] > 20)[0]
        if len(col):
            top[x] = col.min()
    mid = m[(m >= CELL_W * 0.25) & (m <= CELL_W * 0.75)]
    wall_h = np.median(bot[mid] - top[mid]) if len(mid) else 0
    print(f"wallH ~ {wall_h:.1f} tex px")
    # 门洞（栅栏区）x 范围：关闭帧减去无栅栏参考不可用，直接用中段栅栏列——取 bars 竖杆列
    # 简化：门洞 = 两立柱内侧（底边线端点内缩 56px 左右），由 spec 语义给定
    gateX = (round(A[0] + 42), round(B[0] - 42))
    print(f"gateX ~ {gateX}")
    print("face tex coords (cell):", A, B)


if __name__ == "__main__":
    main()
