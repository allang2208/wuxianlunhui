#!/usr/bin/env python3
"""黑狼重建 sheet 验证（黑狼 CLEAN 铁律，2026-08-07 十五~十七版）。

判据（全部满足才算 CLEAN）：
  stray          每 512 格 alpha>30 连通域数 == 1（无孤立色块）
  semi           alpha∈(8,245) 像素数 == 0（硬边）
  trans_nonblack alpha<8 且 RGB 非黑像素数 == 0
  edge_bright    不透明亮像素（alpha>=250, lum>150）邻接透明区像素数 == 0
  composite_residue 合成到 180 背景后边缘带亮度残留 == 0
用法（ComfyUI venv python）：
  python blackwolf-rebuild-verify.py [--dir <输出目录>] [--file 文件名]
"""

import argparse
import os

import numpy as np
from PIL import Image


def verify_sheet(path, cell=512):
    im = np.array(Image.open(path).convert("RGBA"))
    h, w = im.shape[:2]
    rgb = im[..., :3].astype(np.float64)
    alpha = im[..., 3].astype(np.float64)

    rows, cols = h // cell, w // cell
    stray = 0
    for r in range(rows):
        for c in range(cols):
            sub = alpha[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
            ys, xs = np.where(sub > 30)
            if not len(xs):
                stray += 1
                continue
            # 连通域计数
            from scipy import ndimage
            # 8 连通（与 quadruped-rebuild 的 cv2.connectedComponents 同口径，
            # 默认 4 连通会把毛屑碎片拆开导致 stray 虚高）
            lab, n = ndimage.label((sub > 30).astype(np.uint8),
                                   structure=np.ones((3, 3), np.uint8))
            if n != 1:
                stray += n - 1

    semi = int(((alpha > 8) & (alpha < 245)).sum())
    trans_nonblack = int(((alpha < 8) & (rgb.mean(axis=2) > 8)).sum())

    opaque = alpha >= 250
    bright = opaque & (rgb.mean(axis=2) > 150)
    trans = alpha < 200
    big = trans.astype(np.uint8)
    near = np.zeros((h, w), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= (np.roll(np.roll(big, dy, axis=0), dx, axis=1) > 0)
    edge_bright = int((near & bright).sum())

    a = alpha / 255.0
    comp = rgb * a[..., None] + 180 * (1 - a[..., None])
    lum = comp.mean(axis=2)
    edge_band = (a > 0.05) & (a < 0.98)
    composite_residue = int((edge_band & (lum > 175)).sum())

    cov = 100 * (alpha > 0).mean()
    return dict(cov=cov, stray=stray, semi=semi, trans_nonblack=trans_nonblack,
                edge_bright=edge_bright, composite_residue=composite_residue)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\blackwolf-rebuild-out")
    ap.add_argument("--file", default=None)
    ap.add_argument("--cell", type=int, default=None, help="格子尺寸（默认黑狼文件名自动，其余 512）")
    args = ap.parse_args()

    names = (["black_wolf_walk.png", "black_wolf_run.png", "black_wolf_pounce.png",
              "black_wolf_bite_regular.png"] if not args.file else [args.file])
    for n in names:
        p = os.path.join(args.dir, n)
        if not os.path.exists(p):
            print(f"{n}: MISSING")
            continue
        cell = args.cell or (640 if n == "black_wolf_pounce.png" else 512)
        r = verify_sheet(p, cell=cell)
        ok = all(v == 0 for k, v in r.items() if k != "cov")
        print(f"{n}: cov={r['cov']:.1f}% stray={r['stray']} semi={r['semi']} "
              f"trans_nonblack={r['trans_nonblack']} edge_bright={r['edge_bright']} "
              f"composite_residue={r['composite_residue']} -> {'CLEAN' if ok else 'DIRTY!'}")


if __name__ == "__main__":
    main()
