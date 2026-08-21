#!/usr/bin/env python3
"""插帧后中间帧脚底线校准（2026-08-21）。

RIFE alpha 通道插值会软化最底行 → 中间帧脚底比原帧高 2~14px，
28/32fps 下读作上下弹跳。本脚本把每个中间帧在格内整像素竖移，
底边（alpha>32 口径）对齐相邻两原帧底边的均值。原帧不动，无损平移。
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
DIR = os.path.join(ROOT, 'assets', 'companions', 'elise')
CELL = 640

# name -> (cols, rows, total_frames, 原帧判定函数)
SPECS = {
    'walking.png': (5, 5, 24, lambda i: i % 2 == 0),
    'running.png': (5, 7, 34, lambda i: i < 10 or i % 2 == 0),
}


def bottom_of(cell):
    m = cell[..., 3] > 32
    if m.sum() < 50:
        return None
    return int(np.where(m)[0].max())


def fix(fname, spec):
    cols, rows, count, is_orig = spec
    path = os.path.join(DIR, fname)
    arr = np.asarray(Image.open(path).convert('RGBA')).copy()

    def cell(i):
        return arr[(i // cols) * CELL:(i // cols + 1) * CELL, (i % cols) * CELL:(i % cols + 1) * CELL]

    bottoms = [bottom_of(cell(i)) for i in range(count)]
    out = arr.copy()
    diffs = []
    for i in range(count):
        if is_orig(i):
            continue
        # 相邻原帧：walk 回绕 mid 23 → 22/0；run 末 mid 33 → 32/10
        prev_i = i - 1
        nxt_i = i + 1
        if nxt_i >= count:
            nxt_i = 0 if fname == 'walking.png' else 10
        b0, b1 = bottoms[prev_i], bottoms[nxt_i]
        if b0 is None or b1 is None or bottoms[i] is None:
            continue
        target = (b0 + b1) / 2.0
        dy = int(round(target - bottoms[i]))
        if dy == 0:
            diffs.append(0)
            continue
        c = cell(i)
        m = c[..., 3] > 8
        ys = np.where(m)[0]
        top, bot = int(ys.min()), int(ys.max())
        dy = max(-top, min(CELL - 1 - bot, dy))
        moved = np.zeros_like(c)
        if dy > 0:
            moved[dy:, :] = c[:CELL - dy, :]
        else:
            moved[:CELL + dy, :] = c[-dy:, :]
        out[(i // cols) * CELL:(i // cols + 1) * CELL, (i % cols) * CELL:(i % cols + 1) * CELL] = moved
        diffs.append(dy)

    Image.fromarray(out).save(path, format='PNG')
    new_bottoms = []
    for i in range(count):
        c = out[(i // cols) * CELL:(i // cols + 1) * CELL, (i % cols) * CELL:(i % cols + 1) * CELL]
        new_bottoms.append(bottom_of(c))
    print(f'{fname}: 中间帧竖移 {diffs}')
    print(f'  校准后底边 min/max = {min(b for b in new_bottoms if b)}/{max(b for b in new_bottoms if b)}')


for f, spec in SPECS.items():
    fix(f, spec)
