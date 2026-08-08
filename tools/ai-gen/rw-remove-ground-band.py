#!/usr/bin/env python3
"""红狼人贴图"地面平台色带"清理（2026-08-08 三十版）。

根因：H3 视频生成时红狼人脚下有一条完整水平矩形深色带（y 380~408、
x 110~362、约 250px 宽），像"地面"被当主体保留——用户多次反馈
"底部像地面的大块色块"，贴图 alpha 清理（灰粉/阴影）都不覆盖它。

判定：每帧自下而上找"连续跨度 >200px 的行"组成矩形带；带内像素若
其列上方 40px（y-40~y-1）没有身体像素（alpha>30），判定为平台延伸，
删除（alpha=0 + RGB=0）；保留与上方身体相连的真腿脚。

用法（任意 python，纯 PIL/numpy/scipy）：
  python rw-remove-ground-band.py --in <目录> --files a.png,b.png
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def clean_sheet(path, cell, cols, rows):
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    a = arr[..., 3]
    rgb = arr[..., :3]
    removed = 0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = a[y0:y0 + cell, x0:x0 + cell].copy()
            rc = rgb[y0:y0 + cell, x0:x0 + cell].copy()

            # 1) 从下往上找连续矩形带（每行连续跨度 >200px）
            band_rows = []
            for y in range(cell - 1, cell // 2, -1):
                row = np.where(ac[y] > 30)[0]
                if len(row) >= 200 and (row.max() - row.min()) >= 240:
                    band_rows.append(y)
                elif band_rows:
                    break
            if len(band_rows) < 8:
                continue
            y_hi = max(band_rows)   # 带底
            y_lo = min(band_rows)   # 带顶
            band = np.zeros_like(ac, bool)
            band[y_lo:y_hi + 1, :] = True

            # 2) 带内像素：与"带顶部上方腿部轮廓"取交集——带内保留列范围 =
            #    腿部行（y_lo-44 ~ y_lo-4，腿宽仅 40~50px）的像素列；
            #    超出腿宽的部分（平台左右延伸，实测 336px 完美矩形 vs
            #    腿 40px）删除。参考列取带顶部上方，避免窗口滑入带自身。
            leg_ref_y0 = max(0, y_lo - 44)
            leg_ref_y1 = max(0, y_lo - 4)
            leg_cols = (ac[leg_ref_y0:leg_ref_y1, :] > 30).any(axis=0)
            for y in range(y_lo, y_hi + 1):
                in_band = band[y, :] & (ac[y, :] > 30)
                drop = in_band & (~leg_cols)
                ac[y, drop] = 0
                rc[y, drop] = 0
                removed += int(drop.sum())

            # 3) 删除后保留最大连通域（防腿脚断开产生孤岛）
            lab, n = ndimage.label(ac > 30)
            if n > 1:
                sizes = ndimage.sum(ac > 30, lab, range(1, n + 1))
                big = int(sizes.max())
                for i, s in enumerate(sizes, 1):
                    if s < big * 0.01:
                        drop = lab == i
                        ac[drop] = 0
                        rc[drop] = 0
                        removed += int(s)

            a[y0:y0 + cell, x0:x0 + cell] = ac
            rgb[y0:y0 + cell, x0:x0 + cell] = rc
    Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), "RGBA").save(path)
    print(f"cleaned {os.path.basename(path)}: removed {removed}px", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--files", default=None)
    args = ap.parse_args()
    jobs = [
        ("red_wolf_king_changed_run.png", 7, 2, 512),
        ("red_wolf_king_changed_attack.png", 4, 3, 512),
        ("red_wolf_king_transformed_idle.png", 1, 1, 512),
    ]
    only = set(f.strip() for f in (args.files or "").split(",") if f.strip())
    for name, cols, rows, cell in jobs:
        if only and name not in only:
            continue
        p = os.path.join(args.indir, name)
        if os.path.exists(p):
            clean_sheet(p, cell, cols, rows)


if __name__ == "__main__":
    main()
