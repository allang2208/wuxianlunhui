# -*- coding: utf-8 -*-
# 扫描 witch/cauldron 4x8 切割 sheet 的每格 alpha>10 像素数，确定实际内容帧区间
import sys
from PIL import Image

FILES = [
    ("assets/enemies/witch/idle.png", 4, 8),
    ("assets/enemies/witch/walking.png", 4, 8),
    ("assets/enemies/witch/attacking.png", 4, 8),
    ("assets/enemies/witch/attacking-2.png", 4, 8),
    ("assets/enemies/witch/dying.png", 4, 8),
    ("assets/enemies/witch/projective.png", 4, 8),
    ("assets/enemies/cauldron/bowl.png", 4, 8),
]

for path, cols, rows in FILES:
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    cw, ch = w // cols, h // rows
    print(f"\n== {path}  size={w}x{h}  cell={cw}x{ch} ==")
    px = img.load()
    idx = 0
    counts = []
    for r in range(rows):
        for c in range(cols):
            cnt = 0
            for y in range(r * ch, (r + 1) * ch, 2):
                for x in range(c * cw, (c + 1) * cw, 2):
                    if px[x, y][3] > 10:
                        cnt += 1
            counts.append(cnt)
            idx += 1
    line = ""
    for i, cnt in enumerate(counts):
        line += f"{i}:{cnt}  "
        if (i + 1) % cols == 0:
            print(line)
            line = ""
    if line:
        print(line)
    nonempty = [i for i, c in enumerate(counts) if c > 0]
    print("non-empty frames:", nonempty)
