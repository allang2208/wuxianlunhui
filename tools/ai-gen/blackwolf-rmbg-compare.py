#!/usr/bin/env python3
"""黑狼精灵图 旧/新 抠图质量对比（2026-08-07）。

对比指标（同一套合成压测口径）：
  cov         alpha>0 覆盖率
  semi        alpha 在 (0,250) 的半透像素数
  bright_semi lum>150 且 0<alpha<250 的亮半透像素数（白边/灰圈主要来源）
  residue     合成到 180 亮度背景后，边缘带内亮度残留像素数
用法（ComfyUI venv python）：
  python blackwolf-rmbg-compare.py [--old 目录] [--new 目录] [--file 文件名]
"""

import argparse
import os

import numpy as np
from PIL import Image


def verify(rgb, alpha, composite_bg=180):
    a = alpha.astype(np.float64) / 255.0
    out = rgb * a[..., None] + composite_bg * (1 - a[..., None])
    lum = out.mean(axis=2)
    edge_band = (a > 0.05) & (a < 0.98)
    return int((edge_band & (lum > composite_bg - 5)).sum())


def stats(im):
    rgb = im[..., :3].astype(np.float64)
    a = im[..., 3]
    cov = 100 * (a > 0).mean()
    semi = int(((a > 0) & (a < 250)).sum())
    lum = rgb.mean(axis=2)
    bright_semi = int((((a > 0) & (a < 250)) & (lum > 150)).sum())
    return cov, semi, bright_semi, verify(rgb, a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", default=r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies")
    ap.add_argument("--new", default=r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\blackwolf-rmbg-out")
    ap.add_argument("--file", default=None, help="只对比指定文件")
    args = ap.parse_args()

    names = (["black_wolf_idle.png", "black_wolf_walk.png", "black_wolf_run.png",
              "black_wolf_bite_regular.png", "black_wolf_pounce.png", "black_wolf_updown.png"]
             if not args.file else [args.file])
    for n in names:
        old_p = os.path.join(args.old, n)
        new_p = os.path.join(args.new, n)
        if not (os.path.exists(old_p) and os.path.exists(new_p)):
            print(f"{n}: missing (old={os.path.exists(old_p)} new={os.path.exists(new_p)})")
            continue
        o = stats(np.array(Image.open(old_p).convert("RGBA")))
        nw = stats(np.array(Image.open(new_p).convert("RGBA")))
        print(f"{n}")
        print(f"  OLD cov={o[0]:.1f}% semi={o[1]} bright_semi={o[2]} residue={o[3]}")
        print(f"  NEW cov={nw[0]:.1f}% semi={nw[1]} bright_semi={nw[2]} residue={nw[3]}")


if __name__ == "__main__":
    main()
