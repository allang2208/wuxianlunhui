# -*- coding: utf-8 -*-
"""任意方形纹理 → 四边完美环绕的无缝纹理（偏移叠融法）

做法：原图 A 与"半幅偏移回绕"的 B 按枕头权重混合——
边缘处权重→B（B 的四边来自 A 的相邻列/行，天然连续），中心权重→A（保留细节）。
对泥/沙这类低频噪点纹理，过渡带不可见；产出可直接作连续铺贴纹理。

用法：python tools/ai-gen/make-seamless.py <输入.png> <输出.png>
"""
from PIL import Image
import numpy as np
import sys


def main():
    src, dst = sys.argv[1], sys.argv[2]
    a = np.array(Image.open(src).convert('RGB')).astype(np.float64)
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    mx = np.minimum(xx, w - 1 - xx) / (w / 2)
    my = np.minimum(yy, h - 1 - yy) / (h / 2)
    m = np.clip(np.minimum(mx, my), 0, 1)
    m = m * m * (3 - 2 * m)  # smoothstep
    out = a * m[..., None] + b * (1 - m[..., None])
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, optimize=True)

    # 验证：四边匹配度（应远低于随机列对比）
    o = out.astype(int)
    hs = np.abs(o[:, 0, :] - o[:, w - 1, :]).mean()
    vs = np.abs(o[0, :, :] - o[h - 1, :, :]).mean()
    hr = np.abs(o[:, 0, :] - o[:, 400, :]).mean()
    vr = np.abs(o[0, :, :] - o[400, :, :]).mean()
    print(f'{dst}: {w}x{h}  H seam {hs:.1f} (rand {hr:.1f})  V seam {vs:.1f} (rand {vr:.1f})')


main()
