# -*- coding: utf-8 -*-
"""路线 B 闸门合成 v2：
岩壁墙（单块 box，底边干净直线 slope≈0.64）+ 独立渲染铁栅 → 平行四边形门洞（顶/底边与墙底边平行）
+ 铁栅非等比缩放填满门洞、底部冗余 40px → 16 帧程序化升起 → 4x4 打包 demon_gate.png。
几何标定输出：w/h/wallH/slope/face/gateX（供 ISO_WALL_GEO 更新）。
"""
from PIL import Image
import numpy as np

WALL_PNG = r'Y:\工作\无尽轮回\scratch\demon_gate_wall.png'
BARS_PNG = r'Y:\工作\无尽轮回\scratch\demon_gate_bars.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'
CELL_W = 640
HOLE_FRAC = 0.72   # 门洞高 = wallH * HOLE_FRAC（墙顶留岩）
SLACK = 40         # 铁栅底部冗余（裁齐底边后仍全覆盖）
FRAMES = 16


def crop_content(arr):
    ys, xs = np.nonzero(arr[:, :, 3] > 8)
    return arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def bottom_line(a):
    """镜像后墙底边拟合：返回 slope/intercept（y = s*x + b），只取中段干净列。"""
    h, w = a.shape[:2]
    bot = np.full(w, -1.0)
    for x in range(w):
        col = np.nonzero(a[:, x, 3] > 20)[0]
        if len(col):
            bot[x] = col.max()
    valid = np.nonzero(bot >= 0)[0]
    m = valid[(valid >= w * 0.12) & (valid <= w * 0.88)]
    s, b = np.polyfit(m, bot[m], 1)
    return s, b, m, bot


wall = np.array(Image.open(WALL_PNG).convert('RGBA'))
bars = np.array(Image.open(BARS_PNG).convert('RGBA'))
wall = wall[:, ::-1, :]          # v → h：底边向右下（slope>0）
bars = bars[:, ::-1, :]
wall_c = crop_content(wall)
bars_c = crop_content(bars)

sc = CELL_W / wall_c.shape[1]
wall_im = Image.fromarray(wall_c).resize((CELL_W, int(wall_c.shape[0] * sc)), Image.LANCZOS)
wall_a = np.array(wall_im)
CELL_H = wall_a.shape[0]

# 墙底边线
s, b, m, bot = bottom_line(wall_a)
ground = lambda x: s * x + b

# 门洞 x 范围：铁栅同比例宽（居中）
bars_w_cell = int(bars_c.shape[1] * sc)
door_x0 = (CELL_W - bars_w_cell) // 2
door_x1 = door_x0 + bars_w_cell

# 门洞高：按墙高比例；洞顶线 = 底边线向上平移 HOLE_H
mid = np.nonzero(bot >= 0)[0]
mid = mid[(mid >= CELL_W * 0.25) & (mid <= CELL_W * 0.75)]
wallH = np.median(bot[mid] - np.array([np.nonzero(wall_a[:, x, 3] > 20)[0].min() for x in mid]))
HOLE_H = int(wallH * HOLE_FRAC)
hole_top = lambda x: ground(x) - HOLE_H
print(f'precut: slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}deg wallH={wallH:.1f} '
      f'face=[[{int(m.min())}, {int(round(b + s * m.min()))}], [{int(m.max())}, {int(round(b + s * m.max()))}]]')

# 裁门洞：每列从洞顶线到底边线清空
door_top_y = min(int(hole_top(door_x0)), int(hole_top(door_x1)))
for x in range(door_x0, door_x1):
    y0 = int(np.ceil(hole_top(x)))
    y1 = int(np.floor(ground(x)))
    y0 = max(y0, 0)
    y1 = min(y1, CELL_H - 1)
    if y1 + 2 > y0:
        wall_a[y0:min(y1 + 3, CELL_H), x, 3] = 0

# 铁栅：非等比缩放填门洞（宽=门宽，高=洞高+冗余）
ground_span = int(round(s * (door_x1 - door_x0)))
bars_h_dst = HOLE_H + SLACK + ground_span
bars_im = Image.fromarray(bars_c).resize(
    (max(1, door_x1 - door_x0), max(1, bars_h_dst)), Image.LANCZOS)
bars_a = np.array(bars_im)
bars_h = bars_a.shape[0]

frames = []
for n in range(FRAMES):
    f = wall_a.copy()
    rise = bars_h * n / (FRAMES - 1)
    top_y = hole_top(door_x0) - rise
    # 目标区域（逐列裁剪）：门洞内 [hole_top(x), ground(x)]
    for x in range(door_x0, door_x1):
        y_lo = int(np.ceil(hole_top(x)))
        y_hi = int(np.floor(ground(x)))
        y_lo = max(y_lo, 0)
        y_hi = min(y_hi, CELL_H - 1)
        if y_hi <= y_lo:
            continue
        # 铁栅源列
        bx = x - door_x0
        src_top = int(top_y)
        src_bot = src_top + bars_h
        # 可见段 = [y_lo, y_hi] ∩ [src_top, src_bot]
        v0 = max(y_lo, src_top)
        v1 = min(y_hi, src_bot)
        if v1 <= v0:
            continue
        col = bars_a[:, bx, :]
        mask = col[v0 - src_top:v1 - src_top, 3] > 8
        if not mask.any():
            continue
        region = f[v0:v1, x, :]
        region[mask] = col[v0 - src_top:v1 - src_top][mask]
    if n == 0:
        # 关闭帧：把铁栅锯齿底边到地面线之间的空隙用深铁色填实（底梁），
        # 避免关闭时底部透光/悬空；开启帧不填（保持门洞通透）。
        for x in range(door_x0, door_x1):
            hole_lo = max(0, int(np.ceil(hole_top(x))))
            g_hi = min(CELL_H - 1, int(np.floor(ground(x))))
            if g_hi <= hole_lo:
                continue
            rows = np.nonzero(f[hole_lo:g_hi + 1, x, 3] > 8)[0]
            if len(rows):
                bot_row = int(rows.max()) + hole_lo
                if bot_row < g_hi:
                    f[bot_row + 1:g_hi + 1, x] = (38, 38, 42, 255)
    frames.append(Image.fromarray(f))

sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))
for n, fr in enumerate(frames):
    sheet.paste(fr, ((n % 4) * CELL_W, (n // 4) * CELL_H))
sheet.save(DST)

# ---- 几何标定（frame0 底边；门洞列排除）----
f0 = np.array(frames[0])[:, :, 3]
bot0 = np.full(CELL_W, -1.0)
top0 = np.full(CELL_W, -1.0)
for x in range(CELL_W):
    col = np.nonzero(f0[:, x] > 20)[0]
    if len(col):
        top0[x], bot0[x] = col.min(), col.max()
valid = np.nonzero(bot0 >= 0)[0]
sel = valid[~np.isin(valid, np.arange(door_x0, door_x1 + 1))]
sel = sel[(sel >= CELL_W * 0.05) & (sel <= CELL_W * 0.95)]
s2, b2 = np.polyfit(sel, bot0[sel], 1)
resid = np.abs(bot0[sel] - (s2 * sel + b2))
face = [[int(sel.min()), int(round(b2 + s2 * sel.min()))],
        [int(sel.max()), int(round(b2 + s2 * sel.max()))]]
midv = valid[(valid >= CELL_W * 0.25) & (valid <= CELL_W * 0.75)]
wallH2 = np.median(bot0[midv] - top0[midv])
print(f'saved {DST} cell {CELL_W}x{CELL_H} sheet {sheet.size}')
print(f'door x=[{door_x0},{door_x1}] width={door_x1-door_x0} hole_h={HOLE_H}')
print(f'face slope={s2:.4f} angle={np.degrees(np.arctan(s2)):.2f}deg resid_max={resid.max():.1f}')
print(f'face = {face}')
print(f'wallH={wallH2:.1f}')
print(f'geo(precut): w={CELL_W} h={CELL_H} slope={s:.4f} wallH={wallH:.1f} gateX=[{door_x0},{door_x1}]')
