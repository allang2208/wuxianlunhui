# -*- coding: utf-8 -*-
"""Beretta 93R 武器贴图归一（手枪类标准：内容宽 0.862 / 中心 (0.487, 0.524) / 画布 2048²，沙鹰布局）
源图 1536² 透明底带噪点孤岛 → 最大连通域 → 归一 → assets/weapons/beretta93r.png
"""
from PIL import Image
import numpy as np
import cv2

SRC = 'E:/无尽轮回/游戏/素材库/武器/枪械类/Beretta 93R/Beretta 93R.png'
DST = 'assets/weapons/beretta93r.png'
CANVAS = 2048
CONTENT_W = 0.862 * CANVAS          # ≈1766
CENTER = (0.487 * CANVAS, 0.524 * CANVAS)  # ≈(997, 1073)

im = Image.open(SRC).convert('RGBA')
arr = np.array(im)
mask = (arr[:, :, 3] > 10).astype(np.uint8)
n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
if n > 2:
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    arr[labels != keep] = 0
a = arr[:, :, 3]
ys, xs = np.nonzero(a > 10)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
content = arr[y0:y1, x0:x1]
cw, ch = content.shape[1], content.shape[0]
print(f'内容包围盒 {cw}x{ch} @({x0},{y0})')

s = CONTENT_W / cw
nw, nh = round(cw * s), round(ch * s)
res = Image.fromarray(content).resize((nw, nh), Image.LANCZOS)
out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
px = round(CENTER[0] - nw / 2)
py = round(CENTER[1] - nh / 2)
out.alpha_composite(res, (px, py))
out.save(DST, optimize=True)
print(f'归一完成: 内容 {nw}x{nh} 中心 ({px + nw // 2},{py + nh // 2}) 目标 ({round(CENTER[0])},{round(CENTER[1])}) -> {DST}')
