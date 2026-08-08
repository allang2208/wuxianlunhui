#!/usr/bin/env python3
"""红狼人贴图"脚下浅灰接触阴影"清除（2026-08-08 三十一版）。

根因链：
  1. H3 视频生成时角色脚下自带浅灰接触阴影（lum 200~244，非纯白 254+）；
  2. 切帧/抠图把它当主体保留（v5 的"白色带" lum 229 就是它）；
  3. rw-cutout-clean 脚底带归一化把它染成深红毛色 (35,3,4) —— 变成和主体
     一模一样的深色块，颜色清理再也分不开。

修复：**浅灰阴影直接删除（alpha=0 + RGB=0），不染色**。红狼毛是深红
(35,3,4)，lum 200~244 的像素不可能是毛色，只可能是背景/阴影残留。
仅处理 y≥300 的脚下带区域，避免误伤身体上的浅色毛发（如有）。

用法（任意 python）：
  python rw-clear-foot-gray.py --in <目录> --files a.png,b.png
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def clean_sheet(path, cell, cols, rows, lum_lo=200, lum_hi=245, y_min=300):
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    a = arr[..., 3]
    rgb = arr[..., :3]
    removed = 0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = a[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            lum = rc.mean(axis=2)
            gray_band = (ac > 30) & (lum >= lum_lo) & (lum < lum_hi)
            if y_min:
                gray_band[:max(0, y_min), :] = False
            n = int(gray_band.sum())
            if n:
                ac[gray_band] = 0
                rc[gray_band] = 0
                removed += n
            # 删除后保留最大连通域（防腿脚断开孤岛）
            lab, nlab = ndimage.label(ac > 30)
            if nlab > 1:
                sizes = ndimage.sum(ac > 30, lab, range(1, nlab + 1))
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
    print(f"cleaned {os.path.basename(path)}: removed {removed}px gray shadow", flush=True)


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
