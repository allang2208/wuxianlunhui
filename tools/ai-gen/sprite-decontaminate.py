#!/usr/bin/env python3
"""精灵图边缘去污（matting decontamination，2026-08-07）。

AI 生成主体（H3 视频/FLUX 图）边缘像素是"背景色+主体色"的混合：
RGB 是灰的、alpha 半透明——贴图在透明背景看不出，合成到游戏地板就显
灰圈/白边/黑晕（黑狼反复抠不干净的根因）。本工具：
  1. 半透像素（0<α<1）：反推前景色 F = clamp((C−(1−α)·B)/α, 0, 255)，
     B=已知背景色（默认白 255）——把混合灰还原成真实毛色；
  2. 轮廓边缘的不透明亮像素（α≥0.98 且 8 邻域有透明、亮度>150）：
     RGB 压暗到主体暗色（黑狼=18；可 --edge-dark 覆盖）——生成时边缘
     混合残留在不透明像素上，按主体色兜底；
  3. 透明区（α<0.03）RGB 归零。

验证（必须做）：把贴图合成到游戏地板背景色（--composite-bg），检查
边缘带亮残留=0（合成后边缘亮度≈主体毛色，不高于背景）。

用法：
  python sprite-decontaminate.py <input.png> [--bg 255] [--edge-dark 18]
      [--composite-bg 180] [--out <path>]
"""
import argparse
import os

import numpy as np
from PIL import Image


def decontaminate(path, bg=255, edge_dark=18, composite_bg=180, out=None):
    a = np.array(Image.open(path).convert('RGBA')).astype(np.float64)
    h, w = a.shape[:2]
    rgb = a[..., :3].copy()
    alpha = a[..., 3] / 255.0

    # 1) 半透像素反推前景色（straight alpha）
    semi = (alpha > 0.03) & (alpha < 0.98)
    if semi.any():
        inv = 1.0 - alpha[semi]
        f = (rgb[semi] - inv[:, None] * bg) / alpha[semi][:, None]
        rgb[semi] = np.clip(f, 0, 255)
    # 1b) 半透反推后仍亮（F≈背景=未分离的残留）→ 归零（黑狼边缘半透无浅毛，
    #     165 阈值安全；彩色主体如需保留亮边缘调低激进度）
    semi2 = (alpha > 0.03) & (alpha < 0.98)
    if semi2.any() and (rgb[semi2].mean(axis=1) > 165).any():
        drop = semi2 & (rgb.mean(axis=2) > 165)
        alpha[drop] = 0
        rgb[drop] = 0

    # 2) 轮廓边缘不透明亮像素压暗（生成时混合残留）
    opaque = alpha >= 0.98
    bright = opaque & (rgb.mean(axis=2) > 150)
    trans = alpha < 0.8
    big = np.zeros((h, w), np.uint8)
    big[trans] = 1
    near_trans = np.zeros((h, w), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            sh = np.roll(np.roll(big, dy, axis=0), dx, axis=1)
            near_trans |= (sh > 0)
    edge_bright = near_trans & bright
    rgb[edge_bright] = edge_dark

    # 3) 透明区 RGB 归零
    rgb[alpha < 0.03] = 0

    a[..., :3] = rgb
    out_p = out or path
    Image.fromarray(a.astype(np.uint8), 'RGBA').save(out_p)

    # 4) 合成验证
    out_img = rgb * alpha[..., None] + composite_bg * (1 - alpha[..., None])
    out_img = np.clip(out_img, 0, 255)
    lum = out_img.mean(axis=2)
    edge_band = (alpha > 0.05) & (alpha < 0.98)
    residue = int((edge_band & (lum > composite_bg - 5)).sum())
    print(f'{os.path.basename(path)} -> {os.path.basename(out_p)}: '
          f'semi_fixed={int(semi.sum())} edge_darkened={int(edge_bright.sum())} '
          f'composite_residue={residue}px', flush=True)
    return residue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input', help='input PNG')
    ap.add_argument('--bg', type=int, default=255, help='source background color (0-255)')
    ap.add_argument('--edge-dark', type=int, default=18, help='edge bright pixel fallback color')
    ap.add_argument('--composite-bg', type=int, default=180, help='verification background luminance')
    ap.add_argument('--out', default=None, help='output PNG (default: overwrite)')
    args = ap.parse_args()
    decontaminate(args.input, args.bg, args.edge_dark, args.composite_bg, args.out)


if __name__ == '__main__':
    main()
