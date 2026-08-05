#!/usr/bin/env python3
"""路线 B 成品处理：从 Blender 渲染图（透明背景）标定几何并入库。

- 每级 cover_<g>_v.png → 内容 bbox / 端面底部角点（face 端点）/ aspect / sizeH；
- 派生 h = flip(v)；
- 备份现有 assets 贴图并替换；
- 打印每级 COVER_FACE / COVER_ASPECT 更新表。

face 端点语义：显示空间偏移，相对 foot（贴图底边中心 = 原图 (512,1024)）。
端点取端面底部角点（墙段真正接地处），拼接时两端角点相邻。
"""
import os
import shutil
import sys

from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERR = os.path.join(ROOT, 'assets', 'terrain')
RAW = r'Y:\工作\无尽轮回\scratch\world122\raw'
SIZE = 1024
THR = 128


def analyze(path):
    a = np.array(Image.open(path).convert('RGBA'))
    al = a[..., 3]
    m = al > THR
    ys, xs = np.where(m)
    if len(xs) == 0:
        return None
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    # 端面底部角点：最左/最右列的最低 alpha 像素
    left_col = xs.min()
    right_col = xs.max()
    lx = left_col
    ly = int(np.where(m[:, left_col])[0].max())
    rx = right_col
    ry = int(np.where(m[:, right_col])[0].max())
    # 中段底边直线（排除端部 20%）
    cols = np.where(m.max(axis=0))[0]
    lo = int(len(cols) * 0.2)
    hi = int(len(cols) * 0.8)
    mid_cols = cols[lo:hi]
    pts = [(c, int(np.where(m[:, c])[0].max())) for c in mid_cols]
    X = np.array([p[0] for p in pts]); Y = np.array([p[1] for p in pts])
    k, b = np.polyfit(X, Y, 1)
    resid = Y - (k * X + b)
    aspect = (bbox[2] - bbox[0]) / (bbox[3] - bbox[1])
    # face 端点 = 中段底边直线在内容两端（端面位置）的投影 y——
    # 端面角点会偏离直线（端面凸起），拼接底边以中段直线为准
    lx2 = int(bbox[0])
    rx2 = int(bbox[2])
    ly2 = int(k * lx2 + b)
    ry2 = int(k * rx2 + b)
    return {
        'bbox': bbox, 'aspect': aspect,
        'corner': ((lx, ly), (rx, ry)),
        'face': ((lx2, ly2), (rx2, ry2)),
        'midSlope': float(k), 'midResid': float(np.abs(resid).max()),
    }


def to_disp(px, py, size_h):
    return (round((px - SIZE / 2) * 260 / SIZE), round((py - SIZE) * size_h / SIZE))


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    rows = []
    for g in 'FEDCBA':
        if only and g not in only:
            continue
        path = os.path.join(RAW, f'cover_{g}_v.png')
        if not os.path.exists(path):
            print('skip', g)
            continue
        info = analyze(path)
        if not info:
            print('skip empty', g)
            continue
        # sizeH 反推：显示斜率 = 原图斜率 × sizeH/260，要求 = 世界斜率 0.4976
        # （显示缩放 x=260、y=sizeH 非等比，不能用内容框宽高比直接定 sizeH）
        size_h = round(260 * abs(info['midSlope']) / 0.4976)
        aspect_out = 260 / size_h
        va = to_disp(info['face'][0][0], info['face'][0][1], size_h)
        vb = to_disp(info['face'][1][0], info['face'][1][1], size_h)
        rows.append((g, info, size_h, va, vb))
        print(f"[{g}] bbox={info['bbox']} aspect={aspect_out:.3f} sizeH={size_h} "
              f"face原图={info['face']} midSlope={info['midSlope']:.3f} resid={info['midResid']:.1f} "
              f"face v A={va} B={vb}")

    print('\n--- JS 更新表 ---')
    for g, info, size_h, va, vb in rows:
        aspect_out = 260 / size_h
        print(f"    {g}: {{ v: {{ A: {{ x: {va[0]}, y: {va[1]} }}, B: {{ x: {vb[0]}, y: {vb[1]} }} }}, "
              f"h: {{ A: {{ x: {-vb[0]}, y: {vb[1]} }}, B: {{ x: {-va[0]}, y: {va[1]} }} }} }},  // aspect {info['aspect']:.3f} sizeH {size_h}")
    print('COVER_ASPECT: ' + ', '.join(
        f"{g}: {{h: {round(260/size_h, 3)}, v: {round(260/size_h, 3)}}}" for g, info, size_h, *_ in rows))


if __name__ == '__main__':
    main()
