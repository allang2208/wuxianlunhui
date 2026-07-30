# -*- coding: utf-8 -*-
"""方形地板纹理 → 30° 等距菱形地砖（game-dev 地牢地砖标准）
用法：.venv-sprites/Scripts/python.exe tools/cut-diamond-tile.py <输入图> <输出图> [目标宽]
- 输入：任意方形无缝地板纹理（AI 只出方形图，成功率远高于直接出菱形）
- 处理：按 alpha/亮度去底 → 切 30° 菱形（tan30°=0.5774，与 hub_brick/blackbrick 同标准）
- 输出：透明底菱形 PNG，宽度默认 416（blackbrick5~8 档；主神空间砖 393 档传 393）
- 可选 --bg-black：源图是黑底不透明图时按亮度抠底
"""
from PIL import Image
import numpy as np
import sys

def main():
    src = sys.argv[1]
    dst = sys.argv[2]
    target_w = int(sys.argv[3]) if len(sys.argv) > 3 else 416
    bg_black = '--bg-black' in sys.argv

    im = Image.open(src).convert('RGBA')
    arr = np.array(im)
    h, w = arr.shape[:2]

    if bg_black:
        bright = arr[:, :, :3].astype(int).sum(axis=2)
        arr[:, :, 3] = np.where(bright > 48, 255, 0).astype(np.uint8)

    # 菱形遮罩：以图中心为顶点，30° 边线（|dx|/rx + |dy|/ry <= 1，ry=rx×0.5774）
    cx, cy = w / 2, h / 2
    rx = w / 2 * 0.98
    ry = rx * 0.5774
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (np.abs(xx - cx) / rx + np.abs(yy - cy) / ry) <= 1.0
    arr[:, :, 3] = np.where(inside, arr[:, :, 3], 0).astype(np.uint8)

    # 包围盒裁剪 + 缩放
    a = arr[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    arr = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    out = Image.fromarray(arr)
    s = target_w / out.width
    out = out.resize((target_w, round(out.height * s)), Image.LANCZOS)
    out.save(dst, optimize=True)
    print(f'{dst}: {out.size}（菱形边斜率 0.5774=30°，与地牢地砖同标准）')

main()
