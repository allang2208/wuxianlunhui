# -*- coding: utf-8 -*-
"""恶魔洞窟地砖处理：白底抠图 + 内容包围盒裁剪 + 压缩，入库 demonbrick1.png。
"""
from PIL import Image
import numpy as np

SRC = r'Y:\工作\无尽轮回\scratch\demon_floor_v1.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demonbrick1.png'

im = Image.open(SRC).convert('RGBA')
arr = np.array(im)
px = arr[:, :, :3].astype(int)
bright = px.mean(axis=2)
white = (bright > 228) & (arr[:, :, 3] > 200)
arr[:, :, 3][white] = 0
arr[:, :, 3][arr[:, :, 3] < 60] = 0
ys, xs = np.nonzero(arr[:, :, 3] > 8)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
im2 = Image.fromarray(arr).crop((x0, y0, x1 + 1, y1 + 1))
scale = min(1.0, 640 / max(im2.size))
if scale < 1:
    im2 = im2.resize((int(im2.width * scale), int(im2.height * scale)), Image.LANCZOS)
im2.save(DST)
print(f'saved {DST} {im2.width}x{im2.height}')
