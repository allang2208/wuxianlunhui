#!/usr/bin/env python3
"""精灵图逐格高度归一化（2026-08-08，BiRefNet bbox 误拉高补偿）。
rebuild-h3-birefnet 的 bbox 若被脚底噪声/阴影拉高，uniform-h 后该格主体会偏矮
（实测 run 中 4 帧 206~221 高 vs 正常 262）。本脚本把每格内容统一缩放到 target_h、
脚底重新锚定 feet_y（默认 262/410，与 SKILL 惯例一致）。
用法：python rw-normalize-cell-height.py --in x.png [--cell 512] [--target-h 262] [--feet-y 410]
"""
import argparse
import os

import numpy as np
from PIL import Image
import cv2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--target-h", type=int, default=262)
    ap.add_argument("--feet-y", type=int, default=410)
    ap.add_argument("--center-x", type=int, default=256)
    args = ap.parse_args()

    im = np.array(Image.open(args.src).convert("RGBA"))
    rgb = im[..., :3].astype(np.float64)
    alpha = im[..., 3].astype(np.float64)
    cell = args.cell
    rows, cols = alpha.shape[0] // cell, alpha.shape[1] // cell
    fixed = 0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            a = alpha[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            ys, xs = np.where(a > 30)
            if not len(xs):
                continue
            ch = ys.max() - ys.min() + 1
            if ch >= args.target_h - 2:
                continue
            # 内容 bbox（含边缘）
            x1, y1 = xs.min(), ys.min()
            cw = xs.max() - xs.min() + 1
            crop_rgb = rc[y1:y1 + ch, x1:x1 + cw]
            crop_a = a[y1:y1 + ch, x1:x1 + cw]
            nw = max(1, round(cw * args.target_h / ch))
            # 重建空白格
            new_cell_rgb = np.zeros((cell, cell, 3), np.float64)
            new_cell_a = np.zeros((cell, cell), np.float64)
            ox = args.center_x - nw // 2
            oy = args.feet_y - args.target_h + 1
            if ox < 0 or ox + nw > cell or oy < 0:
                print(f"  WARN cell[{r},{c}] overflow {nw}x{args.target_h} at ({ox},{oy}) - skip")
                continue
            resized_rgb = cv2.resize(crop_rgb.astype(np.uint8), (nw, args.target_h), interpolation=cv2.INTER_AREA)
            resized_a = cv2.resize(crop_a.astype(np.uint8), (nw, args.target_h), interpolation=cv2.INTER_AREA)
            new_cell_rgb[oy:oy + args.target_h, ox:ox + nw] = resized_rgb
            new_cell_a[oy:oy + args.target_h, ox:ox + nw] = resized_a
            rgb[y0:y0 + cell, x0:x0 + cell] = new_cell_rgb
            alpha[y0:y0 + cell, x0:x0 + cell] = new_cell_a
            fixed += 1
            print(f"  fixed cell[{r},{c}] {cw}x{ch} -> {nw}x{args.target_h}")
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(args.src)
    print(f"done, fixed {fixed} cells -> {args.src}")


if __name__ == "__main__":
    main()
