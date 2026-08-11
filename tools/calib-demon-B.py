# -*- coding: utf-8 -*-
"""路线 B 恶魔洞窟几何标定：测量原始墙渲染 + 合成后闸门 sheet，输出 ISO_WALL_GEO 更新值。
方向约定：素材底边向右下（h 向），slope 为正；门洞列从墙底边拟合中排除。"""
from PIL import Image
import numpy as np
import os

WALL_SRC = r'Y:\工作\无尽轮回\scratch\demon_gate_wall.png'
WALL_ASSET = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_wall_straight.png'
GATE_SHEET = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'


def bottom_edges(a):
    h, w = a.shape
    bot = np.full(w, -1.0)
    top = np.full(w, -1.0)
    for x in range(w):
        col = np.nonzero(a[:, x] > 20)[0]
        if len(col):
            top[x], bot[x] = col.min(), col.max()
    return bot, top


def fit_slope(bot, valid):
    if len(valid) < 20:
        return None
    s, i = np.polyfit(valid, bot[valid], 1)
    resid = np.abs(bot[valid] - (s * valid + i))
    return s, i, resid


def report(name, a, exclude=None):
    h, w = a.shape
    bot, top = bottom_edges(a)
    valid = np.nonzero(bot >= 0)[0]
    sel = valid if exclude is None else valid[~np.isin(valid, np.arange(exclude[0], exclude[1] + 1))]
    r = fit_slope(bot, sel)
    mid = valid[(valid >= w * 0.2) & (valid <= w * 0.8)]
    wallH = np.median(bot[mid] - top[mid]) if len(mid) else -1
    print(f'== {name}: size={w}x{h}')
    if r:
        s, i, resid = r
        print(f'   bottom slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}deg resid_max={resid.max():.1f}')
        print(f'   bottom span=({sel.min()},{bot[sel.min()]:.0f})-({sel.max()},{bot[sel.max()]:.0f})')
    print(f'   wallH~={wallH:.0f}')


for src, label in [(WALL_SRC, 'raw gate wall render (v向)'), (WALL_ASSET, 'in-repo straight wall (h向)')]:
    im = Image.open(src).convert('RGBA')
    report(label, np.array(im)[:, :, 3])

sheet = Image.open(GATE_SHEET).convert('RGBA')
CELL_W = 640
CELL_H = sheet.height // 4
f0 = np.array(sheet.crop((0, 0, CELL_W, CELL_H)))[:, :, 3]
bot, top = bottom_edges(f0)
valid = np.nonzero(bot >= 0)[0]

# 门洞：从合成脚本逻辑反推（bars 缩放后宽度 -> door 范围），改为从 alpha 直接找：
# 帧 0 底部 = 墙底边 + 铁栅底边；门洞左右边界 = 墙底边不连续处
col_has = bot >= 0
print(f'== gate sheet: cell {CELL_W}x{CELL_H}')
print(f'   bottom column count={col_has.sum()} of {CELL_W}')
# 找底部断裂点（门洞内墙底缺失）
base_y = bot[col_has]
med = np.median(base_y)
low = col_has & (bot > med + 20)  # 明显低于墙底边的列（铁栅或地板）
print(f'   median bottom y={med:.0f}, columns with bottom>med+20={low.sum()}')
# 门洞范围 = 连续 low 列主段
idx = np.nonzero(low)[0]
if len(idx):
    groups = np.split(idx, np.where(np.diff(idx) > 3)[0] + 1)
    door = max(groups, key=len)
    door_x0, door_x1 = int(door.min()), int(door.max())
    print(f'   door hole x=[{door_x0},{door_x1}] width={door_x1-door_x0}')
    # 墙底边拟合：排除门洞列
    sel = valid[~np.isin(valid, np.arange(door_x0, door_x1 + 1))]
    r = fit_slope(bot, sel)
    if r:
        s, i, resid = r
        print(f'   wall bottom slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}deg resid_max={resid.max():.1f}')
        print(f'   wall face span=({sel.min()},{bot[sel.min()]:.0f})-({sel.max()},{bot[sel.max()]:.0f})')
    mid = valid[(valid >= CELL_W * 0.15) & (valid <= CELL_W * 0.85)]
    print(f'   wallH~={np.median(bot[mid] - top[mid]):.0f}')
else:
    print('   no clear door break found')
