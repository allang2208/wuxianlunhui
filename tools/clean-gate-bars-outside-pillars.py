#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清理铁栅栏门 bars 贴图在石柱内/外的残留（2026-08-17）。

针对当前已生成的 `assets/terrain/cover_gate_*_bars.png` 做一次幂等清理：
  1. 以实际静态柱贴图 `_pillarL/_pillarR.png` 为掩码，并把左右柱的完整
     包围盒也纳入清理区——删除所有叠在石柱区域的钢管像素（含柱体贴图
     透明缝），修复补柱/残柱在柱体上穿模；
  2. 删除左右石柱外边界之外的钢管像素——修复开门时滑出石柱后
     动画帧没有删干净、在柱外留下残影的问题。

不重新渲染、不修改柱子贴图；水平横杆由 `rebuild-cover-gates.py` /
`render-cover-gate.py` 管线重新生成。
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "terrain"
GRADES = ("F", "E", "D", "C", "B", "A")
FRAMES = 16
ALPHA_THRESHOLD = 8
PILLAR_DILATE = 2


def load_rgba(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))


def mask_bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if len(xs) < 32:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    im = Image.fromarray((mask.astype(np.uint8)) * 255)
    return np.array(im.filter(ImageFilter.MaxFilter(radius * 2 + 1))) > 0


def clean_frame(
    frame: np.ndarray,
    pillar_mask: np.ndarray,
    left_x0: int | None,
    right_x1: int | None,
):
    arr = frame.copy()
    alpha = arr[..., 3] > 0
    h, w = arr.shape[:2]
    xx = np.arange(w, dtype=np.int32)[None, :]
    outside = np.zeros((h, w), dtype=bool)
    if left_x0 is not None:
        outside |= xx < left_x0
    if right_x1 is not None:
        outside |= xx > right_x1
    clear = (pillar_mask | outside) & alpha
    arr[clear] = (0, 0, 0, 0)
    return arr, int(clear.sum())


def clean_grade(grade: str) -> bool:
    bars_path = ASSETS / f"cover_gate_{grade}_bars.png"
    pl_path = ASSETS / f"cover_gate_{grade}_pillarL.png"
    pr_path = ASSETS / f"cover_gate_{grade}_pillarR.png"
    if not bars_path.exists() or not pl_path.exists() or not pr_path.exists():
        print(f"[skip] {grade} 缺少 bars/pillar 贴图")
        return False

    sheet = Image.open(bars_path).convert("RGBA")
    cw, ch = sheet.width // 4, sheet.height // 4
    pl = load_rgba(pl_path)
    pr = load_rgba(pr_path)
    if pl.shape[:2] != (ch, cw) or pr.shape[:2] != (ch, cw):
        print(f"[warn] {grade} pillar 尺寸不匹配，跳过")
        return False

    mask_l = pl[..., 3] > ALPHA_THRESHOLD
    mask_r = pr[..., 3] > ALPHA_THRESHOLD
    lb = mask_bbox(mask_l)
    rb = mask_bbox(mask_r)
    left_x0 = lb[0] if lb else None
    right_x1 = rb[2] if rb else None

    # 清理用「柱体整框」：柱框内任何钢管像素都删掉（含石柱贴图透明缝），
    # 防止补柱/滑出钢管在柱体区域穿模；中央门洞在左右柱框之间，不受影响。
    pillar_region = np.zeros((ch, cw), dtype=bool)
    if lb is not None:
        pillar_region[lb[1]:lb[3] + 1, lb[0]:lb[2] + 1] = True
    if rb is not None:
        pillar_region[rb[1]:rb[3] + 1, rb[0]:rb[2] + 1] = True
    pillar_clear = dilate(
        (mask_l | mask_r) | pillar_region, PILLAR_DILATE
    )

    total = 0
    for f in range(FRAMES):
        fx = (f % 4) * cw
        fy = (f // 4) * ch
        frame = np.array(sheet.crop((fx, fy, fx + cw, fy + ch)))
        cleaned, removed = clean_frame(frame, pillar_clear, left_x0, right_x1)
        sheet.paste(Image.fromarray(cleaned), (fx, fy))
        total += removed

    if total:
        sheet.save(bars_path)
    print(
        f"[{grade}] cleaned bars px={total}, "
        f"left_x0={left_x0}, right_x1={right_x1}"
    )
    return total > 0


def main() -> None:
    changed = [g for g in GRADES if clean_grade(g)]
    print("完成:", ", ".join(changed) if changed else "无改动（无需清理）")


if __name__ == "__main__":
    main()
