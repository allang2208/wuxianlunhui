# -*- coding: utf-8 -*-
"""入库直墙 demon_wall_straight.png 干净底边标定（供 ISO_WALL_GEO.demon_straight 更新）。"""
from PIL import Image
import numpy as np

SRC = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_wall_straight.png'
a = np.array(Image.open(SRC).convert('RGBA'))[:, :, 3]
h, w = a.shape
bot = np.full(w, -1.0)
top = np.full(w, -1.0)
for x in range(w):
    col = np.nonzero(a[:, x] > 20)[0]
    if len(col):
        top[x], bot[x] = col.min(), col.max()
valid = np.nonzero(bot >= 0)[0]
m = valid[(valid >= w * 0.12) & (valid <= w * 0.88)]
s, b = np.polyfit(m, bot[m], 1)
resid = np.abs(bot[m] - (s * m + b))
mid = valid[(valid >= w * 0.25) & (valid <= w * 0.75)]
wallH = np.median(bot[mid] - top[mid])
face = [[int(m.min()), int(round(b + s * m.min()))], [int(m.max()), int(round(b + s * m.max()))]]
base = [[0, int(round(b))], [w - 1, int(round(b + s * (w - 1)))]]
print(f'w={w} h={h}')
print(f'slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}deg resid_max={resid.max():.1f}')
print(f'wallH={wallH:.1f}')
print(f'face={face}')
print(f'base={base}')
