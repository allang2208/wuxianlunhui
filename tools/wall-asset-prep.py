# -*- coding: utf-8 -*-
"""墙壁贴图资产准备：alpha 裁剪(去水印/描边) + 内容包围盒裁剪 + 几何锚点实测
输出到 game-dev/assets/terrain/ 与 tools/wall-geo.json
"""
from PIL import Image
import numpy as np
import json
import os

SRC = r'E:/无尽轮回/游戏/素材库/场景/地形/僵尸地牢'
DST = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain'
GEO = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/wall-geo.json'
ALPHA_CUT = 80      # 低于此 alpha 的像素清零（去除 faint 描边/水印）
MARGIN = 6          # 包围盒外扩
MAX_DIM = 1600      # 出图最长边上限

# 列裁剪已全部取消（2026-07-24 用户要求主体保持原样，手动拼合）：
# 只做 alpha 清零（去描边/水印）+ 内容包围盒裁剪 + 压缩，不切端帽/渐隐尾
TRIMS = {}

# (源文件, 目标文件, 类型)  类型: straight / cornerV(∧∨) / cornerH(</>)
JOBS = [
    ('wall-2.png',      'wall_diag.png',          'straight'),
    ('wall-转角上.png', 'wall_corner_top.png',    'cornerV'),
    ('wall-转角下.png', 'wall_corner_bottom.png', 'cornerV'),
    ('wall-转角左.png', 'wall_corner_left.png',   'cornerH'),
    ('wall-转角右.png', 'wall_corner_right.png',  'cornerH'),
]


def col_profiles(a, thr):
    h, w = a.shape
    top = np.full(w, -1.0)
    bot = np.full(w, -1.0)
    for x in range(w):
        col = np.nonzero(a[:, x] > thr)[0]
        if len(col):
            top[x], bot[x] = col.min(), col.max()
    return top, bot


def fit(idx, vals, lo, hi):
    m = (vals >= 0) & (idx >= lo) & (idx <= hi)
    if m.sum() < 3:
        return None
    return np.polyfit(idx[m], vals[m], 1)


def intersect(l1, l2):
    x = (l2[1] - l1[1]) / (l1[0] - l2[0])
    return float(x), float(l1[0] * x + l1[1])


def process(src_name, dst_name, kind):
    im = Image.open(f'{SRC}/{src_name}').convert('RGBA')
    arr = np.array(im)
    arr[arr[:, :, 3] < ALPHA_CUT] = 0
    a = arr[:, :, 3]
    thr = 64
    ys, xs = np.nonzero(a > thr)
    x0 = max(0, xs.min() - MARGIN)
    x1 = min(im.width, xs.max() + 1 + MARGIN)
    y0 = max(0, ys.min() - MARGIN)
    y1 = min(im.height, ys.max() + 1 + MARGIN)
    im2 = Image.fromarray(arr).crop((x0, y0, x1, y1))
    # 超长边时缩小
    if max(im2.size) > MAX_DIM:
        s = MAX_DIM / max(im2.size)
        im2 = im2.resize((round(im2.width * s), round(im2.height * s)), Image.LANCZOS)
    # 列裁剪（端帽/渐隐尾）
    trim = TRIMS.get(dst_name)
    if trim:
        im2 = im2.crop((trim[0], 0, min(trim[1], im2.width), im2.height))
    im2.save(f'{DST}/{dst_name}', optimize=True)
    w, h = im2.size
    a2 = np.array(im2)[:, :, 3]
    top, bot = col_profiles(a2, thr)
    idx = np.arange(w)
    geo = {'w': w, 'h': h, 'kind': kind}

    if kind == 'straight':
        span_x = w
        base = fit(idx, bot, span_x * 0.25, span_x * 0.75)
        topf = fit(idx, top, span_x * 0.25, span_x * 0.75)
        geo['base'] = {'x0': 0.0, 'y0': float(base[1]), 'x1': float(w), 'y1': float(base[0] * w + base[1])}
        geo['slope'] = float(base[0])
        geo['wallH'] = float((base[0] * w / 2 + base[1]) - (topf[0] * w / 2 + topf[1]))
    elif kind == 'cornerV':
        cx = w / 2
        l = fit(idx, bot, w * 0.05, cx - w * 0.12)
        r = fit(idx, bot, cx + w * 0.12, w * 0.95)
        lt = fit(idx, top, w * 0.05, cx - w * 0.12)
        rt = fit(idx, top, cx + w * 0.12, w * 0.95)
        vx, vy = intersect(l, r)
        geo['vertex'] = [vx, vy]
        geo['slopeL'] = float(l[0])
        geo['slopeR'] = float(r[0])
        geo['tipL'] = [0.0, float(l[1])]
        geo['tipR'] = [float(w), float(r[0] * w + r[1])]
        geo['wallH'] = float(((l[0] * w * 0.25 + l[1]) - (lt[0] * w * 0.25 + lt[1]) +
                              (r[0] * w * 0.75 + r[1]) - (rt[0] * w * 0.75 + rt[1])) / 2)
    else:  # cornerH "</>"：列剖面上臂顶边+下臂底边；顶点=凸角柱（内容极值列）的底端
        is_left = 'left' in dst_name
        mid_x0, mid_x1 = w * 0.35, w * 0.92
        lower_base = fit(idx, bot, mid_x0, mid_x1)     # 下臂底边（y 随 x 增大）
        upper_top = fit(idx, top, mid_x0, mid_x1)      # 上臂顶边
        if is_left:
            vx_col = 12
            vx = 0.0
            # 角柱底端 y：最左若干列底边均值
            m = (bot >= 0) & (idx <= vx_col)
            vy = float(bot[m].mean())
            # 顶点(角柱底) -> 上臂方向:沿 upper_top 平行下移墙高；下臂方向:沿 lower_base
            geo['vertex'] = [vx, vy]
            geo['tipUpper'] = [float(w), float(upper_top[0] * w + upper_top[1]) + (vy - (upper_top[0] * 0 + upper_top[1]))]
            # 上臂底边 ≈ 上臂顶边 + 墙高(取角柱处墙高)
            wall_h = vy - float(upper_top[1])
            geo['tipUpper'] = [float(w), float(upper_top[0] * w + upper_top[1]) + wall_h]
            geo['tipLower'] = [float(w), float(lower_base[0] * w + lower_base[1])]
            geo['slopeUpper'] = float(upper_top[0])
            geo['slopeLower'] = float(lower_base[0])
            geo['wallH'] = float(wall_h)
        else:
            m = (bot >= 0) & (idx >= w - 12)
            vy = float(bot[m].mean())
            vx = float(w)
            wall_h = vy - float(upper_top[0] * w + upper_top[1])
            geo['vertex'] = [vx, vy]
            geo['tipUpper'] = [0.0, float(upper_top[1]) + wall_h]
            geo['tipLower'] = [0.0, float(lower_base[1])]
            geo['slopeUpper'] = float(upper_top[0])
            geo['slopeLower'] = float(lower_base[0])
            geo['wallH'] = float(wall_h)
    print(f'{dst_name}: {json.dumps(geo, ensure_ascii=False)}')
    return geo


all_geo = {}
for s, d, k in JOBS:
    all_geo[d] = process(s, d, k)
with open(GEO, 'w', encoding='utf-8') as f:
    json.dump(all_geo, f, ensure_ascii=False, indent=1)
print('saved', GEO)
