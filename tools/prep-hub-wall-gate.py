# -*- coding: utf-8 -*-
"""主神空间大理石墙/门管线（2026-07-29 v2，源图已是透明底 RGBA，无需 GrabCut）
- wall: 最大连通域去孤岛 → 腐蚀1px去边污染 → 包围盒裁剪+最长边1600 → 几何实测(base/face/wallH/slope)
- gate: 同上 + gateX 门洞跨度实测（门柱间"最低不透明 y 远高于底边线"的连续列区间）
产出：assets/terrain/hub_wall_straight.png、assets/terrain/hub_gate.png、tools/hub-geo.json（覆盖）
"""
from PIL import Image
import numpy as np
import cv2
import json

SRC = 'tools/normalized/hub-src'
GEO_OUT = 'tools/hub-geo.json'
MAX_DIM = 1600


def largest_component(mask):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + int(np.argmax(areas))
    print(f'  连通域 {n-1} 个，最大 {areas.max()}，次大 {sorted(areas, reverse=True)[1] if len(areas) > 1 else 0}')
    return labels == keep


def prep(name):
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    arr = np.array(im)
    mask = largest_component(arr[:, :, 3] > 10)
    mask = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    arr[~mask] = 0
    a = arr[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    arr = arr[max(0, ys.min() - 4):ys.max() + 5, max(0, xs.min() - 4):xs.max() + 5]
    out = Image.fromarray(arr)
    if max(out.size) > MAX_DIM:
        s = MAX_DIM / max(out.size)
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    return out


def col_profiles(a, thr=64):
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


def measure_base(a):
    """底边线/墙高/斜率实测（中段拟合避端部）"""
    h, w = a.shape
    top, bot = col_profiles(a)
    idx = np.arange(w)
    base = fit(idx, bot, w * 0.25, w * 0.75)
    topf = fit(idx, top, w * 0.25, w * 0.75)
    geo = {
        'w': w, 'h': h,
        'base': [[0.0, round(float(base[1]), 1)], [float(w), round(float(base[0] * w + base[1]), 1)]],
        'slope': round(float(base[0]), 4),
        'wallH': round(float((base[0] * w / 2 + base[1]) - (topf[0] * w / 2 + topf[1])), 1),
        'topSlope': round(float(topf[0]), 4),
    }
    return geo, base


def do_wall():
    out = prep('wall-src')
    out.save('assets/terrain/hub_wall_straight.png', optimize=True)
    a = np.array(out)[:, :, 3]
    geo, base = measure_base(a)
    w = geo['w']
    inset = round(w * 0.03)
    geo['face'] = [[float(inset), round(float(base[0] * inset + base[1]), 1)],
                   [float(w - inset), round(float(base[0] * (w - inset) + base[1]), 1)]]
    del geo['topSlope']
    print('wall:', json.dumps(geo, ensure_ascii=False))
    return geo


def do_gate():
    out = prep('gate-src')
    out.save('assets/terrain/hub_gate.png', optimize=True)
    a = np.array(out)[:, :, 3]
    h, w = a.shape
    geo, base = measure_base(a)
    # gateX 门洞跨度：列最低不透明 y 比底边线高出门洞阈值（门柱间通透区）
    _, bot = col_profiles(a)
    idx = np.arange(w)
    base_y = base[0] * idx + base[1]
    door_cols = (bot >= 0) & (base_y - bot > 60)
    # 最长连续区间
    best_len, best_span, cur_start = 0, None, -1
    for x in range(w):
        if door_cols[x]:
            if cur_start < 0:
                cur_start = x
        else:
            if cur_start >= 0 and x - cur_start > best_len:
                best_len, best_span = x - cur_start, (cur_start, x - 1)
            cur_start = -1
    if cur_start >= 0 and w - cur_start > best_len:
        best_span = (cur_start, w - 1)
    geo['gateX'] = [int(best_span[0]), int(best_span[1])] if best_span else None
    geo['face'] = geo['base']  # 门墙 face=base 全跨度（与既有 gate 条目同口径）
    del geo['topSlope']
    print('gate:', json.dumps(geo, ensure_ascii=False))
    return geo


geo = {'hub_straight': do_wall(), 'hub_gate': do_gate()}
with open(GEO_OUT, 'w', encoding='utf-8') as f:
    json.dump(geo, f, ensure_ascii=False, indent=1)
print('saved', GEO_OUT)
