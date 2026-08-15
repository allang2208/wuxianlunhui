#!/usr/bin/env python3
"""能源节点贴图后处理：烘焙接地接触阴影 + 裁剪到内容框（2026-08-15）。

参考掩体与地板衔接的墙脚接触阴影（根部 ≈40% 黑 → 向外 64px 渐变到 0）：
billboard 节点无法把阴影烘进地板，改为在贴图底部烘一条椭圆形软接触带
（根部 40% 黑 → 上缘 0，宽度 ≈ 内容宽 1.04，高度 ≈ 内容高 10%），
与掩体墙脚阴影同口径的"贴地感"。最后裁剪透明边到内容框（底部含阴影带）。
用法：python energy-node-post.py <src.png> <dst.png>
"""
import sys

from PIL import Image, ImageDraw

ALPHA_ROOT = 0.40   # 与 FLOOR_EDGE_FADE 墙根 40% 黑同口径
SHADOW_H_RATIO = 0.10
SHADOW_W_RATIO = 0.52


def main():
    src, dst = sys.argv[1], sys.argv[2]
    img = Image.open(src).convert("RGBA")
    bbox = img.getbbox()
    if not bbox:
        img.save(dst)
        return
    bx0, by0, bx1, by1 = bbox
    cw, ch = bx1 - bx0, by1 - by0
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(shadow, "RGBA")
    cx = (bx0 + bx1) / 2
    base_y = by1
    rx = cw * SHADOW_W_RATIO
    ry = max(4, ch * SHADOW_H_RATIO)
    steps = 24
    for i in range(steps, 0, -1):
        t = i / steps
        alpha = int(255 * ALPHA_ROOT * (1 - t))
        d.ellipse([cx - rx * t, base_y - ry * (1 - t) - ry * t, cx + rx * t, base_y + ry * (1 - t) + ry * t],
                  fill=(0, 0, 0, alpha))
    out = Image.alpha_composite(shadow, img)
    out = out.crop(out.getbbox())
    out.save(dst)
    print("post:", dst, out.size)


if __name__ == "__main__":
    main()
