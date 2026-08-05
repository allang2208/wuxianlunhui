# -*- coding: utf-8 -*-
"""精确测量入口两侧门柱的底边端点（渲染图 -> 世界坐标）。"""
import os
from PIL import Image
import numpy as np

TAG = os.environ.get('DOOR_TAG', 'none')
IMG = os.path.join(os.environ.get('IMG_DIR', r'Y:\工作\无尽轮回\scratch\world122\verify'), f'room_render_entrance_{TAG}.png')
ORIGIN = (976.75, 2038.6666666666667)  # crop 左上角世界坐标
SCALE = 2.4

a = np.array(Image.open(IMG).convert('RGB'))
lum = a.astype(float).mean(axis=2)
wall = lum > 40
H, W = wall.shape

# 门洞区域：世界 x 1100-1220 -> crop x (1100-976.75)*2.4 .. (1220-976.75)*2.4
x0 = int((1100 - ORIGIN[0]) * SCALE)
x1 = int((1220 - ORIGIN[0]) * SCALE)
# 左门柱：列在 x0..x1 中，取左半边（世界 x<1160）的最低像素
left_cols = range(x0, int((1160 - ORIGIN[0]) * SCALE))
right_cols = range(int((1160 - ORIGIN[0]) * SCALE), x1)


def lowest_of(cols):
    pts = []
    for c in cols:
        rows = np.where(wall[:, c])[0]
        if len(rows):
            pts.append((c, rows.max()))
    return pts


lpts = lowest_of(left_cols)
rpts = lowest_of(right_cols)


def to_world(pts):
    return [(p[0] / SCALE + ORIGIN[0], p[1] / SCALE + ORIGIN[1]) for p in pts]


lw = to_world(lpts)
rw = to_world(rpts)

if lw:
    # 取最靠近门洞的一端（x 最大）
    l_end = max(lw, key=lambda p: p[0])
    print('[' + TAG + '] left post bottom end:', tuple(round(v, 1) for v in l_end))
if rw:
    r_end = min(rw, key=lambda p: p[0])
    print('[' + TAG + '] right post bottom end:', tuple(round(v, 1) for v in r_end))

# 拟合左/右段底边直线（若点数足够）
if len(lw) > 10:
    xs = np.array([p[0] for p in lw]); ys = np.array([p[1] for p in lw])
    k, b = np.polyfit(xs, ys, 1)
    print('[' + TAG + '] left bottom line slope %.3f  at x=1156 y=%.1f' % (k, k * 1156 + b))
if len(rw) > 10:
    xs = np.array([p[0] for p in rw]); ys = np.array([p[1] for p in rw])
    k, b = np.polyfit(xs, ys, 1)
    print('[' + TAG + '] right bottom line slope %.3f  at x=1156 y=%.1f' % (k, k * 1156 + b))
