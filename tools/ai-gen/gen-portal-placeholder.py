#!/usr/bin/env python3
"""生成世界-122 传送门占位贴图（assets/terrain/portal.png）。

⚠ 占位素材：仅为"建筑面板 + 数值"先行接入服务，正式图走 AI 素材管线替换
（素材库出图 → 裁透明边 → 缩至 ~1024 宽 → 重标 displayH/footOffsetY）。
画布沿用研究院规格 1024×1093，内容贴底（footOffsetY ≈ displayH/2）。

风格：等距斜视石门拱 + 紫青色能量涡，与仓鼠建筑群同尺度。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "terrain" / "portal.png"

W, H = 1024, 1093
GROUND_Y = 980          # 建筑贴底边（内容 maxY 接近 H）
CX = W // 2

rng = np.random.default_rng(122)


def stone(d, box, base, light, dark, radius=18):
    """画一块带左上受光/右下背光的圆角石块。"""
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=radius, fill=base)
    # 受光斜面（左上）
    d.line([(x0 + radius, y0 + 4), (x1 - radius, y0 + 4)], fill=light, width=6)
    d.line([(x0 + 4, y0 + radius), (x0 + 4, y1 - radius)], fill=light, width=6)
    # 背光（右下）
    d.line([(x1 - 4, y0 + radius), (x1 - 4, y1 - radius)], fill=dark, width=8)
    d.line([(x0 + radius, y1 - 4), (x1 - radius, y1 - 4)], fill=dark, width=8)


def main():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ---- 地面基座（等距菱形两层台阶）----
    for i, (hw, hh, col) in enumerate([(300, 88, (74, 70, 84, 255)), (240, 66, (88, 84, 100, 255))]):
        cy = GROUND_Y - 66 - i * 30
        d.polygon([(CX - hw, cy), (CX, cy - hh), (CX + hw, cy), (CX, cy + hh)], fill=col)
        d.line([(CX - hw, cy), (CX, cy + hh), (CX + hw, cy)], fill=(52, 50, 62, 255), width=4)

    # ---- 门拱两柱 ----
    base_top = GROUND_Y - 110
    stone(d, (CX - 250, base_top - 560, CX - 130, base_top), (96, 92, 110, 255), (150, 146, 168, 255), (56, 54, 68, 255))
    stone(d, (CX + 130, base_top - 560, CX + 250, base_top), (96, 92, 110, 255), (150, 146, 168, 255), (56, 54, 68, 255))
    # 柱头
    stone(d, (CX - 262, base_top - 610, CX - 118, base_top - 560), (110, 106, 126, 255), (165, 160, 184, 255), (60, 58, 74, 255), radius=12)
    stone(d, (CX + 118, base_top - 610, CX + 262, base_top - 560), (110, 106, 126, 255), (165, 160, 184, 255), (60, 58, 74, 255), radius=12)

    # ---- 拱顶（半环）----
    arch_cy = base_top - 560
    d.arc((CX - 190, arch_cy - 150, CX + 190, arch_cy + 150), start=180, end=360,
          fill=(104, 100, 120, 255), width=64)
    d.arc((CX - 190, arch_cy - 150, CX + 190, arch_cy + 150), start=180, end=300,
          fill=(152, 148, 170, 255), width=10)
    # 拱顶楔石
    stone(d, (CX - 40, arch_cy - 176, CX + 40, arch_cy - 104), (118, 114, 136, 255), (170, 166, 190, 255), (64, 62, 78, 255), radius=10)

    # ---- 能量涡（独立图层：径向渐变 + 涡纹 + 噪点）----
    energy = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ex0, ey0, ex1, ey1 = CX - 120, arch_cy - 90, CX + 120, base_top - 24
    yy, xx = np.mgrid[0:H, 0:W]
    ecx, ecy = (ex0 + ex1) / 2, (ey0 + ey1) / 2
    rx = (xx - ecx) / ((ex1 - ex0) / 2)
    ry = (yy - ecy) / ((ey1 - ey0) / 2)
    r2 = rx * rx + ry * ry
    mask = np.clip(1.0 - r2, 0, 1) ** 0.7
    # 紫→青径向渐变
    cr = (150 + (70 - 150) * (1 - mask)).astype(np.uint8)
    cg = (70 + (220 - 70) * (1 - mask)).astype(np.uint8)
    cb = (230 + (255 - 230) * (1 - mask)).astype(np.uint8)
    # 涡纹：角度正弦扰动
    theta = np.arctan2(ry, rx)
    swirl = (np.sin(theta * 5 + r2 * 14) * 0.5 + 0.5) * 90
    alpha = (mask * (150 + swirl)).clip(0, 255).astype(np.uint8)
    # 中心亮核
    core = np.clip(1.0 - r2 * 3, 0, 1)
    alpha = np.maximum(alpha, (core * 235).astype(np.uint8))
    ea = np.dstack([cr, cg, cb, alpha])
    energy = Image.fromarray(ea, "RGBA")
    img.alpha_composite(energy)

    # 能量描边光晕
    glow = img.filter(ImageFilter.GaussianBlur(18))
    img = Image.alpha_composite(glow, img)

    # ---- 柱身符文亮线 ----
    d = ImageDraw.Draw(img)
    for sx in (-1, 1):
        px = CX + sx * 190
        for i in range(4):
            ry_ = base_top - 480 + i * 110
            d.line([(px - 12, ry_), (px + 12, ry_ + 24)], fill=(140, 210, 255, 220), width=5)

    # 微调：轻微整体锐化，让石纹边缘干净
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=3))

    # 标准工作流第 2 步：紧身裁透明边（alpha>16 bbox），贴底图 footOffsetY≈displayH/2
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > 16)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    img = img.crop(bbox)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)

    bw, bh = img.size
    display_w = 288
    display_h = round(display_w * bh / bw)
    foot_y = round(display_h / 2)
    print(f"裁剪后 {bw}x{bh}")
    print(f"建议配置: displayW={display_w} displayH={display_h} footOffsetY={foot_y}")


if __name__ == "__main__":
    main()
