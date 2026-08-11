# -*- coding: utf-8 -*-
"""恶魔洞窟岩壁贴图处理 v2：白底抠图 → 裁掉岩突端 → 水平镜像（底边向右下）→
底边拉直（拟合线以下裁剪）→ 几何标定（base/face/slope/wallH）。
输出：assets/terrain/demon_wall_straight.png + 控制台打印 ISO_WALL_GEO.demon_straight 注册值。
"""
from PIL import Image
import numpy as np

SRC = r'Y:\工作\无尽轮回\scratch\demon_wall_v1.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_wall_straight.png'
MAX_DIM = 1600
ALPHA_CUT = 60

im = Image.open(SRC).convert('RGBA')
arr = np.array(im)
h, w = arr.shape[:2]
print(f'source {w}x{h}')

# 1. 白底抠图
px = arr[:, :, :3].astype(int)
bright = px.mean(axis=2)
white = (bright > 228) & (arr[:, :, 3] > 200)
arr[:, :, 3][white] = 0
arr[:, :, 3][arr[:, :, 3] < ALPHA_CUT] = 0

def bottom_profile(alpha):
    hh, ww = alpha.shape
    bot = np.full(ww, -1.0)
    for x in range(ww):
        col = np.nonzero(alpha[:, x] > 20)[0]
        if len(col):
            bot[x] = col.max()
    return bot

# 2. 找干净底边跨度：全体列拟直线，剔除残差 > 60px 的列（岩突/断口），再拟
bot = bottom_profile(arr[:, :, 3])
valid = np.nonzero(bot >= 0)[0]
s, i = np.polyfit(valid, bot[valid], 1)
resid = np.abs(bot[valid] - (s * valid + i))
keep = valid[resid < 60]
s2, i2 = np.polyfit(keep, bot[keep], 1)
print(f'base span cols {keep.min()}..{keep.max()} ({len(keep)}/{len(valid)})')

# 3. 裁剪到干净跨度（去掉左/右岩突）
x0, x1 = int(keep.min()), int(keep.max()) + 1
arr2 = arr[:, x0:x1, :]
bot2 = bottom_profile(arr2[:, :, 3])

# 4. 水平镜像：底边向右下（与 wall_straight/swamp_wall_straight 同向）
arr2 = arr2[:, ::-1, :]
bot2 = bottom_profile(arr2[:, :, 3])

# 5. 内容包围盒 + 底边拉直：拟合中段 60% 底线，裁掉线以下（保留 2px 余量）
ys, xs = np.nonzero(arr2[:, :, 3] > 8)
by0, bx0 = ys.min(), xs.min()
by1, bx1 = ys.max(), xs.max()
ww2 = arr2.shape[1]
mid = np.nonzero((bot2 >= 0) & (np.arange(ww2) >= ww2 * 0.15) & (np.arange(ww2) <= ww2 * 0.85))[0]
slope, intercept = np.polyfit(mid, bot2[mid], 1)
line = slope * np.arange(ww2) + intercept
trim = (np.arange(ww2), None)
for x in range(ww2):
    if bot2[x] >= 0:
        arr2[int(line[x]) + 3:, x, 3] = 0  # 裁掉底线以下（+3px 容差）

# 6. 裁掉端部岩突（底边残差 > 25px 的列），保留干净直线段
bot3a = bottom_profile(arr2[:, :, 3])
valid_a = np.nonzero(bot3a >= 0)[0]
sa, ia = np.polyfit(valid_a, bot3a[valid_a], 1)
resid_a = np.abs(bot3a[valid_a] - (sa * valid_a + ia))
clean = valid_a[resid_a < 15]
if len(clean) > 100:
    xc0, xc1 = int(clean.min()), int(clean.max()) + 1
    arr2 = arr2[:, xc0:xc1, :]
    print(f'end-cap trim -> cols {xc0}..{xc1-1}')

# 7. 再裁剪到内容包围盒 + 压缩
ys, xs = np.nonzero(arr2[:, :, 3] > 8)
cx0, cy0, cx1, cy1 = xs.min(), ys.min(), xs.max(), ys.max()
im3 = Image.fromarray(arr2).crop((cx0, cy0, cx1 + 1, cy1 + 1))
scale = min(1.0, MAX_DIM / max(im3.size))
if scale < 1:
    im3 = im3.resize((int(im3.width * scale), int(im3.height * scale)), Image.LANCZOS)
im3.save(DST)
print(f'saved {DST} {im3.width}x{im3.height}')

# 8. 几何标定（成品像素空间）
a = np.array(im3)[:, :, 3]
hh3, ww3 = a.shape
bot3 = bottom_profile(a)
top3 = np.full(ww3, -1.0)
for x in range(ww3):
    col = np.nonzero(a[:, x] > 20)[0]
    if len(col):
        top3[x] = col.min()
mid3 = np.nonzero((bot3 >= 0) & (np.arange(ww3) >= ww3 * 0.2) & (np.arange(ww3) <= ww3 * 0.8))[0]
slope3, inter3 = np.polyfit(mid3, bot3[mid3], 1)
angle = float(np.degrees(np.arctan(slope3)))
print(f'base slope={slope3:.4f} angle={angle:.2f}°')
# face/base：整条直线底边（端帽已裁净）
full_valid = np.nonzero(bot3 >= 0)[0]
print(f'face = [[{full_valid.min()}, {float(bot3[full_valid.min()]):.0f}], [{full_valid.max()}, {float(bot3[full_valid.max()]):.0f}]]')
mid3b = np.nonzero((bot3 >= 0) & (np.arange(ww3) >= ww3 * 0.25) & (np.arange(ww3) <= ww3 * 0.75))[0]
heights = bot3[mid3b] - top3[mid3b]
print(f'wallH ~= {float(np.median(heights)):.0f} px')
bx0f, by0f = np.nonzero(bot3 >= 0)[0].min(), float(bot3[np.nonzero(bot3 >= 0)[0].min()])
bx1f, by1f = np.nonzero(bot3 >= 0)[0].max(), float(bot3[np.nonzero(bot3 >= 0)[0].max()])
print(f'base = [[{bx0f:.0f}, {by0f:.0f}], [{bx1f:.0f}, {by1f:.0f}]]')
