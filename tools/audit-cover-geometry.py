# -*- coding: utf-8 -*-
"""掩体几何基底审计：每张贴图拉直后的底边端点（世界/显示空间）是否落在
COVER_FACE 直线上？内容框中心是否与贴图中心重合（foot=(W/2,H) 假设）？
这决定"每加一张新图是否都要单独调参"。"""
import math
import os

from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERR = os.path.join(ROOT, 'assets', 'terrain')
ASPECT = {
    'F': {'h': 0.995, 'v': 1.032}, 'E': {'h': 1.111, 'v': 1.037},
    'D': {'h': 1.029, 'v': 1.029}, 'C': {'h': 0.976, 'v': 1.105},
    'B': {'h': 0.886, 'v': 0.842}, 'A': {'h': 1.081, 'v': 1.016},
}
FACE = {
    'v': {'A': (-105, -33), 'B': (104, -137)},
    'h': {'A': (-104, -137), 'B': (105, -33)},
}


def analyze(grade, orient):
    p = os.path.join(TERR, f'obstacle_cover_{grade}_{orient}.png')
    if not os.path.exists(p):
        return None
    img = Image.open(p).convert('RGBA')
    W, H = img.size
    a = np.array(img)
    al = a[..., 3] > 128
    cols = np.where(al.max(axis=0))[0]
    if len(cols) == 0:
        return {'grade': grade, 'orient': orient, 'empty': True}
    # 内容框
    ys, xs = np.where(al)
    bbox = (xs.min(), ys.min(), xs.max(), ys.max())
    # 内容框中心相对贴图中心（显示空间偏移，foot 假设 (W/2,H)）
    cw = bbox[2] - bbox[0]
    ch = bbox[3] - bbox[1]
    cx = (bbox[0] + bbox[2]) / 2 - W / 2
    cy = (bbox[1] + bbox[3]) / 2 - H / 2
    size_h = round(260 / ASPECT[grade][orient])
    sx, sy = 260 / W, size_h / H
    center_disp = (cx * sx, cy * sy)  # 相对贴图中心（显示 px）
    # 底边轮廓端点（左/右 5% 列均值）
    low = {}
    for c in cols:
        r = np.where(al[:, c])[0]
        low[c] = r.max()
    lc = sorted(low.items())
    n = len(lc)
    m = max(1, n // 20)
    lx = np.mean([p[0] for p in lc[:m]])
    ly = np.mean([p[1] for p in lc[:m]])
    rx = np.mean([p[0] for p in lc[-m:]])
    ry = np.mean([p[1] for p in lc[-m:]])
    # 世界/显示空间端点（相对 foot=(W/2,H)）
    dispA = ((lx - W / 2) * sx, (ly - H) * sy)
    dispB = ((rx - W / 2) * sx, (ry - H) * sy)
    # 与 COVER_FACE 端点偏差
    fa, fb = FACE[orient]['A'], FACE[orient]['B']
    dA = math.hypot(dispA[0] - fa[0], dispA[1] - fa[1])
    dB = math.hypot(dispB[0] - fb[0], dispB[1] - fb[1])
    # 拉直后底边斜率（显示空间）vs 标准 ±104/209
    k = (dispB[1] - dispA[1]) / (dispB[0] - dispA[0])
    k_std = -104 / 209 if orient == 'v' else 104 / 209
    return {
        'grade': grade, 'orient': orient, 'W': W, 'H': H, 'sizeH': size_h,
        'bbox': tuple(round(v) for v in bbox),
        'centerDisp': (round(center_disp[0], 1), round(center_disp[1], 1)),
        'dispA': tuple(round(v, 1) for v in dispA),
        'dispB': tuple(round(v, 1) for v in dispB),
        'faceA': fa, 'faceB': fb,
        'errA': round(dA, 1), 'errB': round(dB, 1),
        'slope': round(k, 3), 'slopeStd': round(k_std, 3),
    }


def main():
    rows = []
    for g in 'FEDCBA':
        for o in 'hv':
            r = analyze(g, o)
            if r:
                rows.append(r)
    print('grade o   WxH     sizeH bbox(中心偏移显示px)  底边端点(显示px)  face端点   errA errB 斜率/标准')
    for r in rows:
        if r.get('empty'):
            print(f"{r['grade']}{r['orient']}  EMPTY")
            continue
        print(
            f"{r['grade']}{r['orient']}  {r['W']}x{r['H']:<4} {r['sizeH']:<5} "
            f"{r['bbox']} ({r['centerDisp'][0]},{r['centerDisp'][1]})  "
            f"A{r['dispA']} B{r['dispB']}  A{r['faceA']} B{r['faceB']}  "
            f"{r['errA']:>4} {r['errB']:>4}  {r['slope']}/{r['slopeStd']}"
        )
    # 输出按级别实测端点的 JS 表（用于 COVER_FACE 数据表化）
    if os.environ.get('JS_TABLE') == '1':
        print('\n--- JS TABLE ---')
        for g in 'FEDCBA':
            rv = next(r for r in rows if r['grade'] == g and r['orient'] == 'v')
            rh = next(r for r in rows if r['grade'] == g and r['orient'] == 'h')
            va = (round(rv['dispA'][0]), round(rv['dispA'][1]))
            vb = (round(rv['dispB'][0]), round(rv['dispB'][1]))
            ha = (round(rh['dispA'][0]), round(rh['dispA'][1]))
            hb = (round(rh['dispB'][0]), round(rh['dispB'][1]))
            print(f"    {g}: {{ v: {{ A: {{ x: {va[0]}, y: {va[1]} }}, B: {{ x: {vb[0]}, y: {vb[1]} }} }}, "
                  f"h: {{ A: {{ x: {ha[0]}, y: {ha[1]} }}, B: {{ x: {hb[0]}, y: {hb[1]} }} }} }},")


if __name__ == '__main__':
    main()
