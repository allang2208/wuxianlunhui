# -*- coding: utf-8 -*-
"""地砖参考图 → ControlNet 深度/剪影控制图（add-weapon.py 同款做法）

把现有菱形地砖的 alpha 剪影放大到方形画布（黑底白形），喂给
`flux2-dev-depth --control-image` 锁住菱形构图，模型按提示词重绘材质。

用法：
  python tools/ai-gen/make-tile-depth.py <参考地砖.png> <输出深度图.png> [画布尺寸]
"""
from PIL import Image
import numpy as np
import sys


def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024

    im = Image.open(src).convert('RGBA')
    alpha = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        print('ERROR: empty alpha'); sys.exit(1)
    slab = alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    # 缩放到画布宽度约 98%（与 cut-diamond-tile 的 rx=w/2*0.98 一致），保持 30° 比例
    target_w = round(size * 0.98)
    s = target_w / slab.shape[1]
    slab = np.array(Image.fromarray(slab).resize(
        (target_w, max(1, round(slab.shape[0] * s))), Image.LANCZOS))

    canvas = np.zeros((size, size), dtype=np.uint8)
    y0 = (size - slab.shape[0]) // 2
    x0 = (size - slab.shape[1]) // 2
    canvas[y0:y0 + slab.shape[0], x0:x0 + slab.shape[1]] = slab
    Image.fromarray(canvas, 'L').save(dst, optimize=True)
    print(f'{dst}: {size}x{size}（菱形宽 {target_w}，高 {slab.shape[0]}，斜率 '
          f'{round(slab.shape[0] / target_w, 4)}）')


main()
