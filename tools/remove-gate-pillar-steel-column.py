#!/usr/bin/env python3
"""剔除铁栅栏门右石柱上烘焙的孤立深色钢柱（2026-08-16 用户多轮反馈"贴墙不随门动的钢柱"）。

根因：cover_gate_{F,E,D,C}_pillarR.png 的石柱左缘 x509-530 × y36-350 有一条约 22px 宽、
近黑色（rgb≈28-59）的竖带，与右侧石面颜色差异巨大；镜像的 pillarL 对应位置是均匀石色，
说明它是烘焙进贴图的孤立钢柱，而非对称的柱体阴影。此前所有修复都只改了 bars 贴图，
从未动过 pillarR，因此用户刷新后依然能看到。

修复：用钢柱右侧同行的石料纹理（x535-556）整体拷贝回填 x509-530，保持石面纹理连续；
B/A 档石柱整体即深色主题，不属于杂柱，不处理。

用法：python tools/remove-gate-pillar-steel-column.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GRADES = ("F", "E", "D", "C")
BAND_X0, BAND_X1 = 509, 531  # [x0, x1)
BAND_Y0, BAND_Y1 = 30, 366   # [y0, y1)
SRC_X0, SRC_X1 = 535, 557    # 右侧同高度石料取样条 [x0, x1)


def fix_pillar_r(grade: str) -> bool:
    path = ROOT / "assets" / "terrain" / f"cover_gate_{grade}_pillarR.png"
    if not path.exists():
        print(f"[skip] {path.name} 不存在")
        return False
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size
    if w != 640 or h != 634:
        print(f"[warn] {path.name} 尺寸 {w}x{h} 与预期 640x634 不符，跳过")
        return False

    # 统计修复前暗色像素占比，确认确实存在钢柱带
    def dark_frac(y0: int, y1: int, x0: int, x1: int) -> float:
        n = total = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b, a = px[x, y]
                if a < 25:
                    continue
                total += 1
                if max(r, g, b) < 70 and max(r, g, b) - min(r, g, b) < 18:
                    n += 1
        return n / total if total else 0.0

    before = dark_frac(BAND_Y0, BAND_Y1, BAND_X0, BAND_X1)
    right_ref = dark_frac(BAND_Y0, BAND_Y1, SRC_X0, SRC_X1)
    print(
        f"[{grade}] 钢柱带暗色占比 {before:.2f}（右邻石面参照 {right_ref:.2f}）",
        end="",
    )
    if before - right_ref < 0.25:
        print(" -> 无明显钢柱，跳过")
        return False

    # 逐行把右侧同行石料条拷贝到钢柱带
    for y in range(BAND_Y0, BAND_Y1):
        for dx in range(BAND_X1 - BAND_X0):
            sx = SRC_X0 + dx
            if sx >= w:
                break
            px[BAND_X0 + dx, y] = px[sx, y]

    img.save(path)
    after = dark_frac(BAND_Y0, BAND_Y1, BAND_X0, BAND_X1)
    print(f" -> 修复后暗色占比 {after:.2f}")
    return True


def main() -> None:
    fixed = [g for g in GRADES if fix_pillar_r(g)]
    print("完成:", ", ".join(fixed) if fixed else "无改动")


if __name__ == "__main__":
    main()
