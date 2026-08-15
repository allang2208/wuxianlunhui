#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""铁栅栏门图层拆分（2026-08-15）：
把整门 16 帧 spritesheet 拆成三张独立深度精灵——
  - *_pillarL.png   左柱（静态，单帧）
  - *_pillarR.png   右柱（静态，单帧）
  - *_bars.png      栅栏（16 帧滑出/滑入 spritesheet）
拆法：帧 15 只含两根静态柱子 → 作柱子掩码（柱子像素全帧一致）；
栅栏像素 = 各帧减去柱子掩码。三部分按同一 cell 网格对齐，游戏中按各自
底边线深度锚定（左柱=深端、右柱=浅端、栅栏=中点），实现逐段遮挡。
"""
import os
import sys

from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets", "terrain")
CELL_W = 640
CELL_H = 634
FRAMES = 16


def cell(sheet, n, cw, ch):
    r, c = n // 4, n % 4
    return sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]


def main():
    grades = sys.argv[1:] or list("FEDCBA")
    for g in grades:
        path = os.path.join(ASSETS, f"cover_gate_{g}.png")
        sheet = np.array(Image.open(path).convert("RGBA"))
        cw, ch = sheet.shape[1] // 4, sheet.shape[0] // 4
        f0 = cell(sheet, 0, cw, ch).copy()
        f15 = cell(sheet, FRAMES - 1, cw, ch)
        pillar_mask = f15[..., 3] > 8
        # 左柱 / 右柱（帧 0 的柱子像素，按中分线分左右）
        mid = cw // 2
        mask_l = pillar_mask.copy(); mask_l[:, mid:] = False
        mask_r = pillar_mask.copy(); mask_r[:, :mid] = False
        pl = f0.copy(); pl[~mask_l] = (0, 0, 0, 0)
        pr = f0.copy(); pr[~mask_r] = (0, 0, 0, 0)
        Image.fromarray(pl).save(os.path.join(ASSETS, f"cover_gate_{g}_pillarL.png"))
        Image.fromarray(pr).save(os.path.join(ASSETS, f"cover_gate_{g}_pillarR.png"))
        # 栅栏：16 帧，每帧减去柱子掩码
        bars_cells = []
        for n in range(FRAMES):
            fr = cell(sheet, n, cw, ch).copy()
            fr[pillar_mask] = (0, 0, 0, 0)
            bars_cells.append(fr)
        sheet_bars = Image.new("RGBA", (cw * 4, ch * 4), (0, 0, 0, 0))
        for n, c in enumerate(bars_cells):
            sheet_bars.paste(Image.fromarray(c), ((n % 4) * cw, (n // 4) * ch))
        sheet_bars.save(os.path.join(ASSETS, f"cover_gate_{g}_bars.png"))
        # 校验：帧 0 重组 == 原图
        recon = pl + pr + bars_cells[0]
        diff = int((np.abs(recon.astype(int) - f0.astype(int)) > 4).sum())
        print(f"{g}: parts saved, frame0 reconstruction diff px = {diff}")


if __name__ == "__main__":
    main()
