# -*- coding: utf-8 -*-
"""恶魔洞窟铁闸门 16 帧升起动画合成：关闭态剪影 + 开启态图 → 铁栅自底向上升起。
帧 N = 关闭图，但铁栅区域自底部起 N/15 高度替换为开启图（露出洞口）。
输出：assets/terrain/demon_gate.png（4×4 精灵表，首帧关、末帧开）。
"""
from PIL import Image
import numpy as np
import os

CLOSED = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\verify-shots\demon_gate_frames\frame00.png'
OPEN = r'Y:\工作\无尽轮回\scratch\demon_gate_open.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'
CELL_W, CELL_H = 640, 612

# 1. 关闭态（已抠图）与开启态（白底）→ 白底抠图
closed = np.array(Image.open(CLOSED).convert('RGBA'))
open_raw = np.array(Image.open(OPEN).convert('RGBA'))
bright = open_raw[:, :, :3].astype(int).mean(axis=2)
white = (bright > 228) & (open_raw[:, :, 3] > 200)
open_img = open_raw.copy()
open_img[:, :, 3][white] = 0
open_img[:, :, 3][open_img[:, :, 3] < 60] = 0

# 2. 对齐到并集包围盒
ys, xs = np.nonzero(closed[:, :, 3] > 8)
c0, c1, r0, r1 = xs.min(), xs.max(), ys.min(), ys.max()
ys, xs = np.nonzero(open_img[:, :, 3] > 8)
o0, o1, p0, p1 = xs.min(), xs.max(), ys.min(), ys.max()
x0, x1 = min(c0, o0), max(c1, o1)
y0, y1 = min(r0, p0), max(r1, p1)
closed_c = closed[y0:y1 + 1, x0:x1 + 1]
open_c = open_img[y0:y1 + 1, x0:x1 + 1]
print(f'union bbox x[{x0},{x1}] y[{y0},{y1}] -> {closed_c.shape}')

# 3. 铁栅掩码 = 关闭有、开启无（岩石框两帧都在 → 排除）
bars = (closed_c[:, :, 3] > 40) & (open_c[:, :, 3] <= 40)
rows = np.nonzero(bars.any(axis=1))[0]
if len(rows) == 0:
    raise RuntimeError('no bars mask detected — check open image alignment')
top_bar, bot_bar = rows.min(), rows.max()
print(f'bars y {top_bar}..{bot_bar} (h={bot_bar - top_bar + 1})')

# 4. 生成 16 帧：闸门自底部升起（铁栅下缘向上收起，露出洞口）
frames = []
for n in range(16):
    f = closed_c.copy()
    rise = int((bot_bar - top_bar + 1) * n / 15)
    clear_from = bot_bar - rise  # 此线以下清掉铁栅，露出开启图
    mask_region = bars.copy()
    mask_region[:clear_from, :] = False  # 只保留要清除的下部
    # 清除区用开启图像素填充（透明处保留关闭图的深色洞口打底也行——统一用开启图）
    alpha = f[:, :, 3].copy()
    rgba_out = f.copy()
    for y in range(bot_bar, clear_from - 1, -1):
        if y < 0:
            break
        sel = mask_region[y, :]
        rgba_out[y, sel] = open_c[y, sel]
    frames.append(rgba_out)

# 5. 缩放 + 4×4 打包
scale = min(1.0, CELL_W / frames[0].shape[1])
sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))
for n, fr in enumerate(frames):
    im = Image.fromarray(fr)
    if scale < 1:
        im = im.resize((CELL_W, int(im.height * scale)), Image.LANCZOS)
    # 垂直居中到 cell（门体高度可能小于 CELL_H）
    im2 = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    im2.paste(im, (0, max(0, (CELL_H - im.height) // 2)))
    sheet.paste(im2, ((n % 4) * CELL_W, (n // 4) * CELL_H))
sheet.save(DST)
print(f'saved {DST} {sheet.width}x{sheet.height} cell {CELL_W}x{CELL_H}')
