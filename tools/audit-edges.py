# -*- coding: utf-8 -*-
"""四边墙带底边线追踪审计：逐边裁剪后拟合底边线斜率，检查拼接连续性。"""
import math
import os
from PIL import Image
import numpy as np

IMG = os.path.join(os.environ.get('IMG_DIR', r'Y:\工作\无尽轮回\scratch\world122\verify'), 'room_render_full_slope.png')
a = np.array(Image.open(IMG).convert('RGB'))
lum = a.astype(float).mean(axis=2)
wall = lum > 40
H, W = wall.shape

cx0, cy0 = 268, 1672
bx, by = 900, 2048
rx, ry = 512, 256
verts = {'T': (bx, by - ry), 'R': (bx + rx, by), 'B': (bx, by + ry), 'L': (bx - rx, by)}
edges = [('TL', 'T', 'L'), ('TR', 'T', 'R'), ('LB', 'L', 'B'), ('RB', 'R', 'B')]

for name, a1, a2 in edges:
    P1, P2 = verts[a1], verts[a2]
    dx, dy = P2[0] - P1[0], P2[1] - P1[1]
    ln = math.hypot(dx, dy)
    ux, uy = dx / ln, dy / ln
    nx, ny = -uy, ux  # 边法线
    # 裁剪窗口：沿边全长 + 法线 ±150px，边外侧（法线正方向）留 220 显示墙高
    xs = [P1[0] + ux * t + nx * n for t in (0, ln) for n in (-150, 220)]
    ys = [P1[1] + uy * t + ny * n for t in (0, ln) for n in (-150, 220)]
    x0, x1 = int(max(0, min(xs) - cx0)), int(min(W, max(xs) - cx0 + 1))
    y0, y1 = int(max(0, min(ys) - cy0)), int(min(H, max(ys) - cy0 + 1))
    crop = wall[y0:y1, x0:x1]
    # 逐列最低墙像素（世界坐标）
    pts = []
    for i in range(crop.shape[1]):
        rows = np.where(crop[:, i])[0]
        if len(rows):
            pts.append((i + x0 + cx0, rows.max() + y0 + cy0))
    # 分段拟合（连续 x 段）
    segs = []
    for x, y in pts:
        if segs and x - segs[-1][-1][0] <= 4:
            segs[-1].append((x, y))
        else:
            segs.append([(x, y)])
    print(f'--- {name} 边（{a1}->{a2}，斜率应≈{"+" if uy < 0 else "-"}0.5）---')
    for s in segs:
        xs2 = np.array([p[0] for p in s], dtype=float)
        ys2 = np.array([p[1] for p in s], dtype=float)
        if len(s) >= 25:
            k, b = np.polyfit(xs2, ys2, 1)
            print('  段 x %d-%d: n=%d slope=%.3f y=%.1f..%.1f' % (xs2.min(), xs2.max(), len(s), k, ys2.min(), ys2.max()))
        elif len(s) >= 8:
            print('  短段 x %d-%d: n=%d y=%.0f..%.0f' % (xs2.min(), xs2.max(), len(s), ys2.min(), ys2.max()))
