# -*- coding: utf-8 -*-
"""路线 B 闸门入库：打包表水平镜像（底边向下右，与墙同向）→ 标定 face/slope/wallH。"""
from PIL import Image
import numpy as np

SRC = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'

sheet = Image.open(SRC).convert('RGBA')
CELL_W, CELL_H = 640, 1299
# 水平镜像（v → h）
sheet = sheet.transpose(Image.FLIP_LEFT_RIGHT)
sheet.save(SRC)

f0 = np.array(sheet.crop((0, 0, CELL_W, CELL_H)))[:, :, 3]
bot = np.full(CELL_W, -1.0)
top = np.full(CELL_W, -1.0)
for x in range(CELL_W):
    col = np.nonzero(f0[:, x] > 20)[0]
    if len(col):
        top[x], bot[x] = col.min(), col.max()
valid = np.nonzero(bot >= 0)[0]
# 找干净直线段：中段拟合，残差 < 8 的列
s, i = np.polyfit(valid, bot[valid], 1)
resid = np.abs(bot[valid] - (s * valid + i))
clean = valid[resid < 8]
print('clean bottom span x', clean.min(), clean.max())
m = (valid >= clean.min()) & (valid <= clean.max())
s2, i2 = np.polyfit(valid[m], bot[valid[m]], 1)
resid2 = np.abs(bot[valid[m]] - (s2 * valid[m] + i2))
print(f'face slope={s2:.4f} angle={np.degrees(np.arctan(s2)):.2f}° resid max={resid2.max():.1f}')
print(f'face = [[{clean.min()}, {bot[clean.min()]:.0f}], [{clean.max()}, {bot[clean.max()]:.0f}]]')
mid = (valid >= CELL_W * 0.25) & (valid <= CELL_W * 0.75)
print(f'wallH ~= {np.median(bot[valid[mid]] - top[valid[mid]]):.0f}')
# gateX：门洞 = 两立柱之间（底部干净段的中部）
print(f'gateX ≈ [{clean.min() + 40}, {clean.max() - 40}]')
