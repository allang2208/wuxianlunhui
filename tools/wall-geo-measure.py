# -*- coding: utf-8 -*-
"""墙壁贴图几何实测：顶点锚点 + 臂底线斜率（供瓦片化拼接用）"""
from PIL import Image
import numpy as np

SRC = r'E:/无尽轮回/游戏/素材库/场景/地形/僵尸地牢'
THR = 64


def load(name, maxdim):
    im = Image.open(f'{SRC}/{name}').convert('RGBA')
    scale = maxdim / max(im.size)
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    return im, np.array(im)[:, :, 3]


def col_profiles(a):
    h, w = a.shape
    top = np.full(w, -1)
    bot = np.full(w, -1)
    for x in range(w):
        col = np.nonzero(a[:, x] > THR)[0]
        if len(col):
            top[x], bot[x] = col.min(), col.max()
    return top, bot


def row_profiles(a):
    h, w = a.shape
    left = np.full(h, -1)
    right = np.full(h, -1)
    for y in range(h):
        row = np.nonzero(a[y, :] > THR)[0]
        if len(row):
            left[y], right[y] = row.min(), row.max()
    return left, right


def fit(idx, vals, lo, hi):
    m = (vals >= 0) & (idx >= lo) & (idx <= hi)
    if m.sum() < 3:
        return None
    return np.polyfit(idx[m], vals[m], 1)


def intersect(l1, l2):
    x = (l2[1] - l1[1]) / (l1[0] - l2[0])
    return x, l1[0] * x + l1[1]


def analyze_straight(name):
    im, a = load(name, 1024)
    top, bot = col_profiles(a)
    idx = np.arange(a.shape[1])
    ys, xs = np.nonzero(a > THR)
    x0, x1 = xs.min(), xs.max()
    span = x1 - x0
    # 底边分两段拟合（左端帽区会偏陡，取中段与右段）
    mid = fit(idx, bot, x0 + span * 0.25, x0 + span * 0.75)
    print(f'{name} @{im.size} bbox=({x0},{ys.min()})-({x1},{ys.max()})')
    print(f'  底边线: slope={mid[0]:.4f} b={mid[1]:.1f}  -> y({x0})={mid[0]*x0+mid[1]:.0f} y({x1})={mid[0]*x1+mid[1]:.0f}')
    # 顶边（墙面顶沿）
    topf = fit(idx, top, x0 + span * 0.25, x0 + span * 0.75)
    print(f'  顶边线: slope={topf[0]:.4f} b={topf[1]:.1f}')


def analyze_corner_v(name, maxdim=1024):
    """∧/∨ 型转角：列剖面底边双臂拟合求交点（顶点锚点）"""
    im, a = load(name, maxdim)
    top, bot = col_profiles(a)
    idx = np.arange(a.shape[1])
    ys, xs = np.nonzero(a > THR)
    x0, x1 = xs.min(), xs.max()
    span = x1 - x0
    cx = (x0 + x1) / 2
    l = fit(idx, bot, x0 + span * 0.08, cx - span * 0.12)
    r = fit(idx, bot, cx + span * 0.12, x1 - span * 0.08)
    vx, vy = intersect(l, r)
    print(f'{name} @{im.size} bbox=({x0},{ys.min()})-({x1},{ys.max()})')
    print(f'  左臂底边: slope={l[0]:.4f} b={l[1]:.1f}  右臂底边: slope={r[0]:.4f} b={r[1]:.1f}')
    print(f'  顶点锚点: ({vx:.0f},{vy:.0f})  左端底边 y={l[0]*x0+l[1]:.0f}@x{x0}  右端底边 y={r[0]*x1+r[1]:.0f}@x{x1}')
    lt = fit(idx, top, x0 + span * 0.08, cx - span * 0.12)
    rt = fit(idx, top, cx + span * 0.12, x1 - span * 0.08)
    print(f'  左臂顶边: slope={lt[0]:.4f}  右臂顶边: slope={rt[0]:.4f}')


def analyze_corner_h(name, maxdim=1024):
    """</> 型转角：行剖面左/右边双臂拟合求交点"""
    im, a = load(name, maxdim)
    left, right = row_profiles(a)
    idx = np.arange(a.shape[0])
    ys, xs = np.nonzero(a > THR)
    y0, y1 = ys.min(), ys.max()
    span = y1 - y0
    cy = (y0 + y1) / 2
    prof = left if '左' in name else right
    l = fit(idx, prof, y0 + span * 0.08, cy - span * 0.10)
    r = fit(idx, prof, cy + span * 0.10, y1 - span * 0.08)
    # x = m*y + b 形式（对 y 拟合 x）
    vy, vx = intersect(l, r)
    print(f'{name} @{im.size} bbox=({xs.min()},{y0})-({xs.max()},{y1})')
    print(f'  上臂边线: dx/dy={l[0]:.4f}  下臂边线: dx/dy={r[0]:.4f}')
    print(f'  顶点锚点: ({vx:.0f},{vy:.0f})')


analyze_straight('wall-2.png')
analyze_corner_v('wall-转角上.png')
analyze_corner_v('wall-转角下.png')
analyze_corner_h('wall-转角左.png')
analyze_corner_h('wall-转角右.png')
