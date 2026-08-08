#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""确定性拼接模拟器：按游戏实际映射（260x259 显示、footOffsetY 129.5、COVER_FACE 锚点）
把两段掩体墙摆在同一斜线上，渲染拼接区域，检测竖直暗缝。
用法：python tools/join-sim.py [grade=D] [out=sim_out]
"""
import sys, os, json
import numpy as np
from PIL import Image

SCALE_X = 260.0 / 1024.0
SCALE_Y = 259.0 / 1024.0
FOOT = 129.5

def load_tex(path):
    im = Image.open(path).convert('RGBA')
    return np.asarray(im).astype(np.int16)

def tex_to_world(tex, e, tx, ty):
    """texture px -> world px (v-orient, no flip)"""
    wx = e[0] + (tx - 512) * SCALE_X
    wy = e[1] - FOOT + (ty - 512) * SCALE_Y
    return wx, wy

def render(pieces, cam, size=(900, 620), zoom=1.0, floor_lum=0):
    """pieces: [{tex, x, y}], cam: (cx, cy). 向量化合成，深度按 y 排序。"""
    W, H = size
    canvas = np.zeros((H, W, 4), dtype=np.int16)
    canvas[:, :, 3] = 255  # 不透明深色地面
    if floor_lum:
        canvas[:, :, 0] = floor_lum
        canvas[:, :, 1] = floor_lum
        canvas[:, :, 2] = floor_lum
    ys, xs = np.mgrid[0:H, 0:W]
    wx = cam[0] + (xs - W / 2) / zoom
    wy = cam[1] + (ys - H / 2) / zoom
    depth_order = sorted(range(len(pieces)), key=lambda i: pieces[i]['y'])
    for i in depth_order:
        p = pieces[i]
        e = (p['x'], p['y'])
        tx = 512 + (wx - e[0]) / SCALE_X
        ty = 512 + (wy - e[1] + FOOT) / SCALE_Y
        valid = (tx >= 0) & (tx < 1024) & (ty >= 0) & (ty < 1024)
        txi = np.clip(tx.astype(np.int32), 0, 1023)
        tyi = np.clip(ty.astype(np.int32), 0, 1023)
        px = p['tex'][tyi, txi]
        mask = valid & (px[:, :, 3] > 10)
        canvas[mask] = px[mask]
    return canvas

def main():
    grade = sys.argv[1] if len(sys.argv) > 1 else 'D'
    out = sys.argv[2] if len(sys.argv) > 2 else 'sim_out'
    base = f'assets/terrain'
    os.makedirs('tools/_join_sim', exist_ok=True)
    # 装载 5 个 v 变体
    texs = {}
    for v in range(1, 6):
        name = f'obstacle_cover_{grade}_v' if v == 1 else f'obstacle_cover_{grade}_v{v}_v'
        texs[v] = load_tex(os.path.join(base, name + '.png'))
    # 摆两段：A 在上（852,1816），B 在下（713,1885）——与游戏 TL 边同几何
    results = []
    for va in range(1, 6):
        for vb in range(1, 6):
            pieces = [
                {'tex': texs[va], 'x': 852, 'y': 1816},
                {'tex': texs[vb], 'x': 713, 'y': 1885},
            ]
            cam = (700, 1940)
            canvas = render(pieces, cam)
            lum = canvas[:, :, :3].mean(axis=2)
            alpha = canvas[:, :, 3]
            # 接缝位置：B 的 face A 端世界 (625, 1864)
            seam_sx = int((625 - cam[0]) + 900 / 2)
            seam_sy = int((1864 - cam[1]) + 620 / 2)
            # 检测墙身带（接缝线上方 20-60px）暗竖线
            band = lum[seam_sy-60:seam_sy-20, seam_sx-50:seam_sx+50]
            alpha_band = alpha[seam_sy-60:seam_sy-20, seam_sx-50:seam_sx+50]
            wallmask = alpha_band > 10
            col_med = np.full(band.shape[1], np.nan)
            for i in range(band.shape[1]):
                vals = band[wallmask[:, i], i]
                if len(vals) > 10:
                    col_med[i] = np.median(vals)
            # 找暗列：比左右邻列中位数低 18 以上
            dips = []
            for i in range(2, band.shape[1]-2):
                if np.isnan(col_med[i]): continue
                nbr = min(np.nanmedian(col_med[max(0,i-6):i-1]), np.nanmedian(col_med[i+2:i+7]))
                if not np.isnan(nbr) and col_med[i] < nbr - 18:
                    dips.append((i, col_med[i], nbr))
            merged = []
            for i, c, n in dips:
                if merged and i - merged[-1][0] <= 3:
                    merged[-1][1] = min(merged[-1][1], c)
                    continue
                merged.append([i, c, n])
            has_gap = len(merged) > 0
            results.append((va, vb, has_gap, [(seam_sx-50+m[0], round(float(m[1])), round(float(m[2]))) for m in merged]))
            if va == vb:
                Image.fromarray(canvas.astype(np.uint8)).save(f'tools/_join_sim/{out}_v{va}_v{vb}.png')
    # 汇总：哪些组合有缝
    gaps = [r for r in results if r[2]]
    print('total combos:', len(results), 'with gap:', len(gaps))
    for va, vb, g, d in gaps:
        print(f'  v{va}|v{vb}: {d}')
    with open(f'tools/_join_sim/{out}_summary.json', 'w') as f:
        json.dump(results, f, indent=0)

if __name__ == '__main__':
    main()
