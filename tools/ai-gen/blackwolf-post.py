#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""blackwolf-post.py — 黑狼绿幕 sheet 后处理（SKILL 红狼王二十四~二十七版教训的黑狼版）。

铁律来源：
- 二十七版：禁止固定色压暗边缘（edge-dark 18 会制造一圈人工近黑描边，脚底最显眼，
  "像地板"）；边缘污染像素还原为"该格深色毛中位数"（lum<60 严格深色毛，防浅毛混入
  抬高参考），判定用欧氏距离 >35 而非亮度阈值（亮度阈值会漏中亮残留）。
- 黑狼 CLEAN 惯例：alpha 硬二值化 245（semi=0，接受轻微锯齿）+ 每格最大连通域。
- 线性过滤渗边：透明区 RGB 外渗毛色（<=24px），禁止置黑（黑狼毛发下缩采样出黑边）。

用法（venv-sprites python）：
  python tools/ai-gen/blackwolf-post.py <sheet.png> [--cell 512]
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def post(path, cell=512, hard=245, dist_th=35.0, bleed_px=24):
    a = np.array(Image.open(path).convert("RGBA"))
    rgb = a[..., :3].astype(np.float64)
    alpha = a[..., 3]
    h, w = alpha.shape
    restored_total = 0
    for r in range(h // cell):
        for c in range(w // cell):
            y0, x0 = r * cell, c * cell
            ac = alpha[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            # 1) 硬二值化
            a_bin = np.where(ac >= hard, 255, 0).astype(np.uint8)
            # 2) 最大连通域
            lab, n = ndimage.label(a_bin > 30)
            if n > 1:
                areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
                areas.sort(reverse=True)
                drop = (lab > 0) & (lab != areas[0][1])
                a_bin[drop] = 0
            # 3) 边缘污染像素 -> 该格深色毛中位数（欧氏距离判定）
            opaque = a_bin >= 250
            if opaque.any():
                lum = rc.mean(axis=2)
                dark_fur = opaque & (lum < 60)
                if dark_fur.any():
                    median = np.median(rc[dark_fur], axis=0)
                    trans = a_bin < 200
                    near = ndimage.binary_dilation(trans, iterations=2)
                    edge = opaque & near
                    dist = np.linalg.norm(rc[edge] - median, axis=1)
                    bad = dist > dist_th
                    if bad.any():
                        idx = np.where(edge)
                        rc[idx[0][bad], idx[1][bad]] = median
                        restored_total += int(bad.sum())
            ac[...] = a_bin
    # 4) 透明区 RGB 外渗毛色（<=bleed_px；替代 zero-transparent-rgb 的置黑）
    alpha01 = alpha >= 250
    dist = ndimage.distance_transform_edt(~alpha01)
    _, ind = ndimage.distance_transform_edt(~alpha01, return_indices=True)
    bleed = (~alpha01) & (dist <= bleed_px)
    rgb[bleed] = rgb[ind[0][bleed], ind[1][bleed]]
    rgb[~alpha01 & (dist > bleed_px)] = 0

    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(path)
    print(f"[blackwolf-post] {path}: edge restored {restored_total} px, bled {int(bleed.sum())} px")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--cell", type=int, default=512)
    args = ap.parse_args()
    post(args.sheet, cell=args.cell)


if __name__ == "__main__":
    main()
