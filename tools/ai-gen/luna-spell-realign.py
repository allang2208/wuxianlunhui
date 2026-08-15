#!/usr/bin/env python3
"""露娜 spell 动画重排对齐（2026-08-15）：
spelling.png 为旧素材：人物高 461、质心漂移 208~280、顶部 y=19——施法时人物
在帧内晃动/下沉（"大小没对齐 + 施法贴图后退"）。按与 walk/run 重建相同的标准
（TARGET_H=470、FEET_Y=478、CENTER_X=256、内容质心精确居中）重新缩放定位，
使施法动画与 idle/walk/run 大小、位置一致。
用法：python luna-spell-realign.py [--in assets/.../spelling.png] [--out 同路径]
"""
import argparse
import os

import numpy as np
from PIL import Image

CELL = 512
TARGET_H = 470
FEET_Y = 478
CENTER_X = 256


def align_cell(rgba):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return np.zeros((CELL, CELL, 4), np.uint8), None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    h = y1 - y0
    scale = TARGET_H / h
    nw = max(1, int(round((x1 - x0 + 1) * scale)))
    nh = max(1, int(round((y1 - y0 + 1) * scale)))
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    im = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    content_cx = (float(xs.mean()) - x0) * scale
    px = int(round(CENTER_X - content_cx))
    if px < 2 or px + nw > CELL - 2:
        px = int(round(CENTER_X - nw / 2))
    py = FEET_Y - nh
    if py < 2:
        py = 2
    cell = np.zeros((CELL, CELL, 4), np.uint8)
    cell[py:py + nh, px:px + nw] = np.array(im)
    a = cell[:, :, 3]
    ys2, xs2 = np.where(a > 16)
    cx = float(xs2.mean()) if len(xs2) else 0
    return cell, {'cx': cx, 'nw': nw, 'nh': nh, 'py': py}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', default='assets/companions/luna/spelling.png')
    ap.add_argument('--out', dest='dst', default='')
    args = ap.parse_args()
    dst = args.dst or args.src

    img = Image.open(args.src).convert('RGBA')
    arr = np.array(img)
    fw = fh = CELL
    cols = img.width // fw
    rows = img.height // fh
    n = cols * rows
    out = np.zeros_like(arr)
    infos = []
    for i in range(n):
        fx = (i % cols) * fw
        fy = (i // cols) * fh
        cell, info = align_cell(arr[fy:fy + fh, fx:fx + fw])
        out[fy:fy + fh, fx:fx + fw] = cell
        infos.append(info)
    Image.fromarray(out, 'RGBA').save(dst)

    cxs = [inf['cx'] for inf in infos if inf]
    nhs = [inf['nh'] for inf in infos if inf]
    pys = [inf['py'] for inf in infos if inf]
    print(f'{n} 帧：高度 {min(nhs)}-{max(nhs)}、顶部 y {min(pys)}-{max(pys)}、'
          f'质心跨度 {max(cxs)-min(cxs):.1f}px（{min(cxs):.1f}~{max(cxs):.1f}）')
    print('saved', dst)


if __name__ == '__main__':
    main()
