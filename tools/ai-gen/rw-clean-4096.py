#!/usr/bin/env python3
"""4096² 精灵图清理（2026-08-08）：每帧 512×1024 竖条。

清理：
  1) 脚下浅灰接触阴影（lum 200~244，红狼毛深红不在此区间）删除；
  2) 矩形地面带（连续 >200px 行，参照带顶上方腿部列）删除；
  3) 删除后保留最大连通域。

用法：
  python rw-clean-4096.py --in <sheet.png> --out <cleaned.png> [--cols 8 --rows 4]
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def clean_sheet(path, out, cols, rows, cell_w=512, cell_h=1024):
    arr = np.array(Image.open(path).convert("RGBA"))
    a = arr[..., 3]
    rgb = arr[..., :3]
    removed = 0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell_h, c * cell_w
            ac = a[y0:y0 + cell_h, x0:x0 + cell_w]
            rc = rgb[y0:y0 + cell_h, x0:x0 + cell_w]
            body = ac > 30
            if not body.any():
                continue
            idx = np.argwhere(body)
            ymax = int(idx[:, 0].max())
            lum = rc.mean(axis=2)
            # 1) 脚下浅灰接触阴影
            b = np.zeros_like(body)
            b[max(0, ymax - 40):ymax + 1, :] = True
            gray = b & body & (lum >= 200) & (lum < 245)
            n = int(gray.sum())
            if n:
                ac[gray] = 0
                rc[gray] = 0
                removed += n
            # 2) 矩形地面带：连续 >200px 行
            band_rows = []
            for y in range(max(0, ymax - 90), ymax + 1):
                row = np.where(ac[y] > 30)[0]
                if len(row) >= 200:
                    maxrun = 1; cur = 1
                    for i in range(1, len(row)):
                        cur = cur + 1 if row[i] - row[i - 1] == 1 else 1
                        maxrun = max(maxrun, cur)
                    if maxrun >= 200:
                        band_rows.append(y)
            if len(band_rows) >= 8:
                y_lo, y_hi = min(band_rows), max(band_rows)
                leg_ref_y0 = max(0, y_lo - 44)
                leg_ref_y1 = max(0, y_lo - 4)
                leg_cols = (ac[leg_ref_y0:leg_ref_y1, :] > 30).any(axis=0)
                for y in range(y_lo, y_hi + 1):
                    in_band = (ac[y] > 30)
                    drop = in_band & (~leg_cols)
                    ac[y, drop] = 0
                    rc[y, drop] = 0
                    removed += int(drop.sum())
            # 3) 最大连通域
            lab, nlab = ndimage.label(ac > 30)
            if nlab > 1:
                sizes = ndimage.sum(ac > 30, lab, range(1, nlab + 1))
                big = int(sizes.max())
                for i, s in enumerate(sizes, 1):
                    if s < big * 0.005:
                        drop = lab == i
                        ac[drop] = 0
                        rc[drop] = 0
                        removed += int(s)
            a[y0:y0 + cell_h, x0:x0 + cell_w] = ac
            rgb[y0:y0 + cell_h, x0:x0 + cell_w] = rc
    Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), "RGBA").save(out)
    print(f"cleaned {os.path.basename(path)}: removed {removed}px -> {out}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--rows", type=int, default=4)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for f in os.listdir(args.indir):
        if f.endswith(".png"):
            clean_sheet(os.path.join(args.indir, f), os.path.join(args.out, f),
                        args.cols, args.rows)


if __name__ == "__main__":
    main()
