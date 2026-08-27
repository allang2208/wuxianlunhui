# -*- coding: utf-8 -*-
"""AI 方形地砖图 → 30° 等距菱形地砖（swampbrick-new1 同款配方，2026-08-16 固化）

配方（CHANGELOG 2026-07-26「AI 生成地砖处理入库试用」）：
  白底 45° 菱形单砖 → 泛洪抠图（去白底）→ 腐蚀 2px 去污染 →
  纵向压缩 0.5774（45°→30° 等距）→ 包围盒裁剪 → 定宽缩放。
  深度锁形路线（flux2-klein-4b-depth + 参考砖剪影）输出已是 30° 菱形，
  传 --iso 跳过纵向压缩（只做抠图/腐蚀/裁剪/定宽）。

用法：
  python tools/ai-gen/process-floor-tile.py <输入.png> <输出.png> [目标宽]
  python tools/ai-gen/process-floor-tile.py <输入.png> <输出.png> [目标宽] --iso
  （目标宽默认 510 = swampbrick-new1 菱形宽，同池混铺必须一致）
"""
from PIL import Image, ImageFilter
import numpy as np
import sys
from collections import deque


def flood_fill_background(rgb, tol=36):
    """从四边向内泛洪标记'背景白'：与白距离 < tol 且与边缘连通。"""
    h, w = rgb.shape[:2]
    bg = np.zeros((h, w), dtype=bool)
    d = np.sqrt(((rgb.astype(int) - 255) ** 2).sum(axis=2))
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if d[y, x] < tol and not bg[y, x]:
                bg[y, x] = True; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if d[y, x] < tol and not bg[y, x]:
                bg[y, x] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny, nx] and d[ny, nx] < tol:
                bg[ny, nx] = True; q.append((nx, ny))
    return bg


def main():
    src, dst = sys.argv[1], sys.argv[2]
    target_w = int(sys.argv[3]) if len(sys.argv) > 3 else 510
    iso_input = '--iso' in sys.argv
    erode_px = 2
    vscale = 0.5774  # tan30°

    im = Image.open(src).convert('RGBA')
    arr = np.array(im)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3].astype(np.uint8)

    # 1. 泛洪抠图：与边缘连通的白底 → alpha 0，其余保留
    bg = flood_fill_background(rgb)
    alpha[bg] = 0

    # 2. 腐蚀去白边污染
    a_img = Image.fromarray(alpha, 'L')
    a_img = a_img.filter(ImageFilter.MinFilter(1 + erode_px * 2))
    alpha = np.array(a_img)

    # 3. 纵向压缩 45° → 30°（--iso 输入已为 30°，跳过）
    if not iso_input:
        h, w = alpha.shape
        new_h = max(1, round(h * vscale))
        alpha = np.array(Image.fromarray(alpha).resize((w, new_h), Image.LANCZOS))
        rgb = np.array(Image.fromarray(rgb).resize((w, new_h), Image.LANCZOS))

    # 4. 包围盒裁剪
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        print('ERROR: empty alpha after cutout'); sys.exit(1)
    alpha = alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    rgb = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    # 5. 定宽缩放 + 强制 30° 标准高度（round(target_w × tan30°)，与池内砖同规格）
    out = Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')
    s = target_w / out.width
    out = out.resize((target_w, round(out.height * s)), Image.LANCZOS)
    std_h = round(target_w * 0.5774)
    if out.height != std_h:
        out = out.resize((target_w, std_h), Image.LANCZOS)
    out.save(dst, optimize=True)

    a2 = np.array(out)[:, :, 3]
    yy, xx = np.nonzero(a2 > 8)
    print(f'{dst}: {out.size}  bbox {xx.max()-xx.min()+1}x{yy.max()-yy.min()+1}  '
          f'slope {round((yy.max()-yy.min()+1)/(xx.max()-xx.min()+1), 4)}  '
          f'coverage {round(100*(a2>8).mean(), 1)}%')


main()
