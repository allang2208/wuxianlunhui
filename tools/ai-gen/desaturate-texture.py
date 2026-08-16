# -*- coding: utf-8 -*-
"""地面纹理降饱和 + 微提亮（2026-08-16）

逐像素向灰度混合（保持亮度、不破坏无缝性），让泥/沙更淡更灰。
用法：python tools/ai-gen/desaturate-texture.py <输入.png> <输出.png> [--amount 0.55] [--lighten 1.05]
  --amount：向灰度混合比例（0=原图，1=纯灰；默认 0.55）
  --lighten：整体亮度倍率（默认 1.05）
"""
from PIL import Image
import numpy as np
import sys


def main():
    src, dst = sys.argv[1], sys.argv[2]
    amount = 0.55
    lighten = 1.05
    if '--amount' in sys.argv:
        amount = float(sys.argv[sys.argv.index('--amount') + 1])
    if '--lighten' in sys.argv:
        lighten = float(sys.argv[sys.argv.index('--lighten') + 1])

    a = np.array(Image.open(src).convert('RGB')).astype(np.float64)
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    keep = 1.0 - amount
    out = lum[..., None] + (a - lum[..., None]) * keep
    out *= lighten
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, optimize=True)

    import colorsys
    rgb = out.reshape(-1, 3) / 255.0
    sat = np.array([colorsys.rgb_to_hls(*p)[2] for p in rgb]).mean()
    print(f'{dst}: mean RGB {out.reshape(-1,3).mean(axis=0).round(0).tolist()}  '
          f'饱和度 {round(sat*100,1)}%')


main()
