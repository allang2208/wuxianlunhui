#!/usr/bin/env python3
"""露娜 spell 动画正放+倒放合成（2026-08-15）：
只取当前 spelling.png 前 16 帧（施法手势），合成 32 帧动画：
  cell 0-15 = 正放（帧 0→15）
  cell 16-31 = 倒放（帧 15→0，收手回位）
循环回跳 帧31(≈帧0) → 帧0 无缝。用法：python luna-spell-loop.py
"""
import numpy as np
from PIL import Image

SRC = 'assets/companions/luna/spelling.png'
CELL = 512


def main():
    img = Image.open(SRC).convert('RGBA')
    arr = np.array(img)
    cols = img.width // CELL
    cells = []
    for i in range(16):
        fx = (i % cols) * CELL
        fy = (i // cols) * CELL
        cells.append(arr[fy:fy + CELL, fx:fx + CELL].copy())
    # 正放 0..15 + 倒放 15..0 = 32 帧
    order = list(range(16)) + list(range(15, -1, -1))
    out = np.zeros((4 * CELL, 8 * CELL, 4), np.uint8)
    for idx, src in enumerate(order):
        r, c = divmod(idx, 8)
        out[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cells[src]
    Image.fromarray(out, 'RGBA').save(SRC)
    print('saved', SRC, (8 * CELL, 4 * CELL), '32 帧（正放16 + 倒放16）')


if __name__ == '__main__':
    main()
