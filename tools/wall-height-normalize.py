# -*- coding: utf-8 -*-
"""墙体贴图高度归一化：按列绕底边做纵向缩放，使顶边与底边平行
解决 AI 素材轻微真透视（顶/底边不平行）导致拼接时"底部对齐顶部矮一截"
用法: python wall-height-normalize.py <输入.png> <输出.png>
"""
import sys
from PIL import Image
import numpy as np


def fit_edges(alpha, thr=64):
    h, w = alpha.shape
    top = np.full(w, -1.0)
    bot = np.full(w, -1.0)
    for x in range(w):
        col = np.nonzero(alpha[:, x] > thr)[0]
        if len(col):
            top[x], bot[x] = col.min(), col.max()
    ys, xs = np.nonzero(alpha > thr)
    x0, x1 = int(xs.min()), int(xs.max())
    span = x1 - x0
    idx = np.arange(w)
    m = (bot >= 0) & (idx >= x0 + span * 0.25) & (idx <= x0 + span * 0.75)
    cb = np.polyfit(idx[m], bot[m], 1)
    mt = (top >= 0) & (idx >= x0 + span * 0.25) & (idx <= x0 + span * 0.75)
    ct = np.polyfit(idx[mt], top[mt], 1)
    return cb, ct, x0, x1


def main(src, dst):
    im = Image.open(src).convert('RGBA')
    a = np.array(im).astype(np.float32)
    h, w, _ = a.shape
    alpha = a[:, :, 3]
    cb, ct, x0, x1 = fit_edges(alpha)
    idx = np.arange(w)
    yb = cb[0] * idx + cb[1]          # 底边线
    yt = ct[0] * idx + ct[1]          # 顶边线
    mid = (x0 + x1) / 2
    H = (cb[0] * mid + cb[1]) - (ct[0] * mid + ct[1])  # 目标高度（中部实测）
    print(f'底边 slope={cb[0]:.4f} 顶边 slope={ct[0]:.4f} 目标高度 H={H:.0f}')

    out = np.zeros_like(a)
    rows = np.arange(h, dtype=np.float32)
    for x in range(w):
        if not (alpha[:, x] > 8).any():
            continue
        # 该列输出区间 [yb-H, yb] ← 源区间 [yt, yb]（绕底边纵向缩放，双线性插值）
        out_ys = rows[(rows >= yb[x] - H) & (rows <= yb[x])]
        if len(out_ys) == 0:
            continue
        src_ys = yt[x] + (out_ys - (yb[x] - H)) * (yb[x] - yt[x]) / H
        for c in range(4):
            out[out_ys.astype(int), x, c] = np.interp(src_ys, rows, a[:, x, c])
    # 包围盒裁剪
    al = out[:, :, 3]
    ys, xs = np.nonzero(al > 8)
    out = out[max(0, ys.min() - 6):min(h, ys.max() + 7), max(0, xs.min() - 6):min(w, xs.max() + 7)]
    Image.fromarray(out.astype(np.uint8)).save(dst, optimize=True)
    print('saved', dst, out.shape[1], 'x', out.shape[0])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
