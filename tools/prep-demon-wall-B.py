# -*- coding: utf-8 -*-
"""路线 B 恶魔岩壁墙入库：Blender 渲染（透明底）→ 水平镜像（底边向下右）→
内容裁剪 → 几何标定（base/face/slope/wallH）→ assets/terrain/demon_wall_straight.png。
"""
from PIL import Image
import numpy as np

SRC = r'Y:\工作\无尽轮回\scratch\demon_wall_B.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_wall_straight.png'

im = Image.open(SRC).convert('RGBA')
a = np.array(im)
# 水平镜像：底边 v（向上右）→ h（向下右，与 wall_straight/swamp 同向）
a = a[:, ::-1, :]
# 内容包围盒裁剪
ys, xs = np.nonzero(a[:, :, 3] > 8)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
im2 = Image.fromarray(a).crop((x0, y0, x1 + 1, y1 + 1))
im2.save(DST)

# 几何标定
a2 = np.array(im2)[:, :, 3]
h, w = a2.shape
bot = np.full(w, -1.0)
top = np.full(w, -1.0)
for x in range(w):
    col = np.nonzero(a2[:, x] > 20)[0]
    if len(col):
        top[x], bot[x] = col.min(), col.max()
valid = np.nonzero(bot >= 0)[0]
m = (valid >= w * 0.2) & (valid <= w * 0.8)
s, i = np.polyfit(valid[m], bot[valid[m]], 1)
resid = np.abs(bot[valid[m]] - (s * valid[m] + i))
print(f'saved {DST} {im2.width}x{im2.height}')
print(f'base slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}°')
print(f'face residual max={resid.max():.1f} mean={resid.mean():.1f}')
print(f'face = [[{valid[m].min()}, {bot[valid[m].min()]:.0f}], [{valid[m].max()}, {bot[valid[m].max()]:.0f}]]')
mid = (valid >= w * 0.25) & (valid <= w * 0.75)
heights = bot[valid[mid]] - top[valid[mid]]
print(f'wallH ~= {np.median(heights):.0f}')
bv = np.nonzero(bot >= 0)[0]
print(f'base = [[{bv.min()}, {bot[bv.min()]:.0f}], [{bv.max()}, {bot[bv.max()]:.0f}]]')
