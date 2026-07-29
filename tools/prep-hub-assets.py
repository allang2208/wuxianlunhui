# -*- coding: utf-8 -*-
"""主神空间素材管线（2026-07-29 v1，白底 GrabCut 版）
⚠️ 已被 tools/prep-hub-wall-gate.py（透明底 v2）取代——勿再运行本脚本，
   否则会用过时白底源图覆盖 assets/terrain/hub_wall_straight.png 新版大理石墙！
   保留仅作白底抠图方法论参考（GrabCut+盖板几何重建）。
- altar: 已有透明通道 → 去孤立小域 + 包围盒裁剪 + 压缩
- marble: 黑底亮度抠图 → 最大连通域（去即梦水印孤岛）→ 腐蚀去黑边 → 包围盒裁剪 → 对齐 hub_brick 砖宽
- wall: 白底边界洪水抠图 → 最大连通域 → 腐蚀去白边污染 → 包围盒裁剪 + 最长边1600 → 几何实测(base/face/wallH/slope)
产出：assets/npc/altar.png、assets/terrain/hub_marble.png、assets/terrain/hub_wall_straight.png、tools/hub-geo.json
"""
from PIL import Image
import numpy as np
import cv2
import json
import os

SRC = 'tools/normalized/hub-src'
GEO_OUT = 'tools/hub-geo.json'


def largest_component(mask):
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + int(np.argmax(areas))
    print(f'  连通域 {n-1} 个，最大面积 {areas.max()}，次大 {sorted(areas, reverse=True)[1] if len(areas) > 1 else 0}')
    return labels == keep


def bbox_crop(arr, thr=8, margin=4):
    a = arr[:, :, 3]
    ys, xs = np.nonzero(a > thr)
    x0 = max(0, xs.min() - margin)
    x1 = min(arr.shape[1], xs.max() + 1 + margin)
    y0 = max(0, ys.min() - margin)
    y1 = min(arr.shape[0], ys.max() + 1 + margin)
    return arr[y0:y1, x0:x1], (int(x0), int(y0), int(x1), int(y1))


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


# ---------- 1. 祭坛：透明底已有，去孤岛 + 裁剪 ----------
def do_altar():
    im = Image.open(f'{SRC}/altar-src.png').convert('RGBA')
    arr = np.array(im)
    mask = largest_component(arr[:, :, 3] > 10)
    arr[~mask] = 0
    arr, box = bbox_crop(arr)
    out = Image.fromarray(arr)
    if max(out.size) > 512:
        s = 512 / max(out.size)
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    out.save('assets/npc/altar.png', optimize=True)
    print(f'altar: bbox={box} -> {out.size} saved assets/npc/altar.png')
    return {'w': out.width, 'h': out.height}


# ---------- 2. 大理石地砖：黑底亮度抠图 ----------
def do_marble():
    im = Image.open(f'{SRC}/marble-src.png').convert('RGB')
    arr = np.array(im)
    bright = arr.astype(int).sum(axis=2)
    mask = bright > 48  # 黑底阈值
    mask = largest_component(mask)  # 去即梦水印等孤岛
    # 腐蚀 2px 去黑边污染
    mask = cv2.erode(mask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    rgba = np.dstack([arr, np.where(mask, 255, 0).astype(np.uint8)])
    rgba, box = bbox_crop(rgba)
    out = Image.fromarray(rgba)
    # 对齐 hub_brick 砖宽（alpha 包围盒实测）
    hub = np.array(Image.open('assets/terrain/hub_brick.png').convert('RGBA'))[:, :, 3]
    hxs = np.nonzero(hub > 8)[1]
    hub_w = hxs.max() - hxs.min() + 1
    s = hub_w / out.width
    out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    out.save('assets/terrain/hub_marble.png', optimize=True)
    print(f'marble: bbox={box} hub_brick宽={hub_w} -> {out.size} saved assets/terrain/hub_marble.png')
    return {'w': out.width, 'h': out.height, 'hubBrickW': int(hub_w)}


# ---------- 3. 大理石墙：白底边界洪水抠图 + 几何实测 ----------
def do_wall():
    im = Image.open(f'{SRC}/wall-src.png').convert('RGB')
    arr = np.array(im)
    h, w = arr.shape[:2]
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    # GrabCut：白墙对白底，纯洪水/阈值都会吃墙顶亮面（抗锯齿软边无暗缝可挡）。
    # 确定背景 = 与边界相连的高亮区（>235）；确定前景 = 墙芯暗部（<205 最大连通域，腐蚀2px）；
    # 其余待判定 → GMM + 平滑先验把墙顶亮面整片保住
    bg_seed = (gray > 235).astype(np.uint8)
    ff = bg_seed.copy()
    mask_ff = np.zeros((h + 2, w + 2), np.uint8)
    seeds = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1), (0, w // 2), (h // 2, 0), (h - 1, w // 2), (h // 2, w - 1)]
    for sy, sx in seeds:
        if ff[sy, sx]:
            cv2.floodFill(ff, mask_ff, (sx, sy), 2)
    sure_bg = ff == 2
    dark = (gray < 205).astype(np.uint8)
    dark = cv2.erode(largest_component(dark).astype(np.uint8), np.ones((5, 5), np.uint8))
    sure_fg = dark > 0
    gcm = np.full((h, w), cv2.GC_PR_FGD, np.uint8)
    gcm[sure_bg] = cv2.GC_BGD
    gcm[sure_fg] = cv2.GC_FGD
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), gcm, None, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_MASK)
    wall_mask = ((gcm == cv2.GC_FGD) | (gcm == cv2.GC_PR_FGD)).astype(np.uint8)
    print(f'  grabCut 前景占比 {wall_mask.mean():.3f}')
    # 后处理：小闭运算补盖板石间细缝 → 最大连通域
    wall_mask = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    wall_mask = largest_component(wall_mask).astype(np.uint8)
    # 盖板几何重建：GrabCut 在亮盖板上留坑（白盖白底无暗缝可分）。
    # 墙带顶边必为与底边平行的直线——用各窗格最小顶沿（幸存盖板块）拟合截距，强制斜率=底边，
    # 填充拟合顶边到当前顶沿之间的条带
    tops = np.full(w, -1.0)
    for x in range(w):
        c = np.nonzero(wall_mask[:, x])[0]
        if len(c):
            tops[x] = c.min()
    valid = tops >= 0
    # 底边拟合（列底边，中段）
    bots = np.full(w, -1.0)
    for x in range(w):
        c = np.nonzero(wall_mask[:, x])[0]
        if len(c):
            bots[x] = c.max()
    idx = np.arange(w)
    mbase = (bots >= 0) & (idx > w * 0.25) & (idx < w * 0.75)
    base_fit = np.polyfit(idx[mbase], bots[mbase], 1)
    slope_b = base_fit[0]
    # 窗格最小顶沿 → 幸存盖板的真实顶边
    win = 50
    samples = []
    for x0 in range(0, w, win):
        seg = tops[x0:x0 + win]
        seg = seg[seg >= 0]
        if len(seg):
            samples.append((x0 + np.argmin(seg), seg.min()))
    sx = np.array([s[0] for s in samples])
    sy = np.array([s[1] for s in samples])
    # 截距取偏低分位：拟合线略低于真实顶边——宁可裁掉盖板顶几 px，
    # 也不把源图烘焙的假透明棋盘底纹条带填进来（源图背景=棋盘纹，无暗缝可分）
    intercepts = sy - slope_b * sx
    b_top = np.percentile(intercepts, 30)
    print(f'  盖板重建: slope={slope_b:.4f} b_top={b_top:.1f}（幸存样本 {len(samples)} 个）')
    for x in range(w):
        if not valid[x]:
            continue
        yt = int(round(slope_b * x + b_top))
        if yt < tops[x]:
            wall_mask[max(0, yt):int(tops[x]), x] = 1
    # 缺口二次填充：若某列填充带正下方 40px 内仍是空洞（GrabCut 碎屑挡住首次填充），
    # 用其下方实体的顶沿作为新底界再填一次（盖板带实心，空洞必为假）
    for x in range(w):
        if not valid[x]:
            continue
        yt = int(round(slope_b * x + b_top))
        y0 = int(tops[x])
        if yt >= y0:
            continue
        gap_start = -1
        for y in range(y0, min(y0 + 40, h)):
            if not wall_mask[y, x]:
                if gap_start < 0:
                    gap_start = y
            elif gap_start >= 0:
                wall_mask[yt:gap_start, x] = 1
                break
        else:
            if gap_start >= 0:
                wall_mask[yt:gap_start, x] = 1
    # 填封闭内洞（最终掩码已健康，边界洪水反填安全可靠）
    inv = (1 - wall_mask).astype(np.uint8)
    ff3 = inv.copy()
    mask_ff3 = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff3, mask_ff3, (0, 0), 2)
    wall_mask = wall_mask | (ff3 == 1).astype(np.uint8)
    wall_mask = wall_mask.astype(bool)
    wall_mask = largest_component(wall_mask)
    wall_mask = cv2.erode(wall_mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    rgba = np.dstack([arr, np.where(wall_mask, 255, 0).astype(np.uint8)])
    rgba, box = bbox_crop(rgba)
    out = Image.fromarray(rgba)
    if max(out.size) > 1600:
        s = 1600 / max(out.size)
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    out.save('assets/terrain/hub_wall_straight.png', optimize=True)
    print(f'wall: bbox={box} -> {out.size} saved assets/terrain/hub_wall_straight.png')

    # 几何实测（贴图像素空间）
    a = np.array(out)[:, :, 3]
    hh, ww = a.shape
    top, bot = col_profiles(a)
    idx = np.arange(ww)
    base = fit(idx, bot, ww * 0.25, ww * 0.75)   # 底边线（中段拟合避端部）
    topf = fit(idx, top, ww * 0.25, ww * 0.75)   # 顶沿
    geo = {
        'w': ww, 'h': hh,
        'base': [[0.0, float(base[1])], [float(ww), float(base[0] * ww + base[1])]],
        'slope': float(base[0]),
        'topSlope': float(topf[0]),
        'wallH': float((base[0] * ww / 2 + base[1]) - (topf[0] * ww / 2 + topf[1])),
    }
    # face：两端各内缩 3%（端部锥形砖，拼接用中段平直区）
    inset = round(ww * 0.03)
    geo['face'] = [[float(inset), float(base[0] * inset + base[1])],
                   [float(ww - inset), float(base[0] * (ww - inset) + base[1])]]
    print(f'wall geo: {json.dumps(geo, ensure_ascii=False)}')
    print(f'  顶/底斜率差 {abs(geo["topSlope"] - geo["slope"]):.4f}（>0.03 需过 wall-height-normalize）')
    return geo


geo = {'altar': do_altar(), 'marble': do_marble(), 'hub_straight': do_wall()}
with open(GEO_OUT, 'w', encoding='utf-8') as f:
    json.dump(geo, f, ensure_ascii=False, indent=1)
print('saved', GEO_OUT)
