#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""铁栅栏门图层拆分 + bars 越界清理（2026-08-15 / 2026-08-17）。

把整门 16 帧 spritesheet 拆成三张独立深度精灵——
  - *_pillarL.png   左柱（静态，单帧）
  - *_pillarR.png   右柱（静态，单帧）
  - *_bars.png      栅栏 + 水平横杆（16 帧滑出/滑入 spritesheet）

拆法：帧 15 只含两根静态柱子 → 作柱子掩码（柱子像素全帧一致）；
栅栏像素 = 各帧减去柱子掩码。三部分按同一 cell 网格对齐，游戏中按各自
底边线深度锚定（左柱=深端、右柱=浅端、栅栏=中点），实现逐段遮挡。

2026-08-17 修复「开门时钢管退出石柱后贴图残留/穿模」：
  - 柱子掩码先做 2px 膨胀，清掉柱子边缘的半透明黑边；
  - bars 清理使用左右柱完整包围盒（柱框内钢管全删，含柱体贴图透明缝）；
  - 每帧 bars 额外清除左右柱外边界之外的像素（滑出石柱外的钢管不再残留）。
"""
import os
import sys

from PIL import Image, ImageFilter
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets", "terrain")
FRAMES = 16
ALPHA_THRESHOLD = 8
PILLAR_DILATE = 2


def cell(sheet, n, cw, ch):
    r, c = n // 4, n % 4
    return sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]


def mask_bbox(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) < 32:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def dilate_mask(mask, radius=2):
    if radius <= 0:
        return mask
    im = Image.fromarray((mask.astype(np.uint8)) * 255)
    return np.array(im.filter(ImageFilter.MaxFilter(radius * 2 + 1))) > 0


def clean_bars_cell(frame, pillar_mask, left_x0, right_x1):
    """清除柱子掩码区 + 左右柱外边界之外的 bars 像素。"""
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


def main():
    grades = sys.argv[1:] or list("FEDCBA")
    for g in grades:
        path = os.path.join(ASSETS, f"cover_gate_{g}.png")
        sheet = np.array(Image.open(path).convert("RGBA"))
        cw, ch = sheet.shape[1] // 4, sheet.shape[0] // 4
        f0 = cell(sheet, 0, cw, ch).copy()
        f15 = cell(sheet, FRAMES - 1, cw, ch)

        # 柱子掩码 = 全开帧 15 中残留的静态像素；膨胀清除抗锯齿边缘。
        pillar_mask = dilate_mask(f15[..., 3] > ALPHA_THRESHOLD, PILLAR_DILATE)

        mid = cw // 2
        mask_l = pillar_mask.copy(); mask_l[:, mid:] = False
        mask_r = pillar_mask.copy(); mask_r[:, :mid] = False
        lb = mask_bbox(mask_l)
        rb = mask_bbox(mask_r)
        left_x0 = lb[0] if lb else None
        right_x1 = rb[2] if rb else None

        # bars 清理用「柱体整框」：柱框内任何钢管像素都删掉（含石柱贴图透明缝），
        # 防止补柱/滑出钢管在柱体区域穿模；中央门洞在左右柱框之间，不受影响。
        pillar_region = np.zeros_like(pillar_mask)
        if lb is not None:
            pillar_region[lb[1]:lb[3] + 1, lb[0]:lb[2] + 1] = True
        if rb is not None:
            pillar_region[rb[1]:rb[3] + 1, rb[0]:rb[2] + 1] = True
        pillar_clear = pillar_mask | dilate_mask(pillar_region, 1)

        # 左右柱静态图（取帧 0 的柱子像素）
        pl = f0.copy(); pl[~mask_l] = (0, 0, 0, 0)
        pr = f0.copy(); pr[~mask_r] = (0, 0, 0, 0)
        Image.fromarray(pl).save(os.path.join(ASSETS, f"cover_gate_{g}_pillarL.png"))
        Image.fromarray(pr).save(os.path.join(ASSETS, f"cover_gate_{g}_pillarR.png"))

        # 栅栏 + 水平横杆：16 帧，逐帧去掉柱子区与柱外越界残留
        bars_cells = []
        total_removed = 0
        for n in range(FRAMES):
            fr, removed = clean_bars_cell(
                cell(sheet, n, cw, ch), pillar_clear, left_x0, right_x1
            )
            bars_cells.append(fr)
            total_removed += removed

        sheet_bars = Image.new("RGBA", (cw * 4, ch * 4), (0, 0, 0, 0))
        for n, c in enumerate(bars_cells):
            sheet_bars.paste(Image.fromarray(c), ((n % 4) * cw, (n // 4) * ch))
        sheet_bars.save(os.path.join(ASSETS, f"cover_gate_{g}_bars.png"))

        # 校验：清理后帧 0 重组与全门图的差异应只来自柱子/越界像素。
        recon = pl + pr + bars_cells[0]
        diff = int((np.abs(recon.astype(int) - f0.astype(int)) > 4).sum())
        print(
            f"{g}: parts saved, pillarL bbox={lb}, pillarR bbox={rb}, "
            f"bars cleaned px={total_removed}, frame0 recon diff px={diff}"
        )


if __name__ == "__main__":
    main()
