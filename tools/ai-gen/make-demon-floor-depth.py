# -*- coding: utf-8 -*-
"""恶魔洞窟地砖深度模板：取 swampbrick-new1 的 alpha 剪影，摆到 1024² 画布
（黑底、白主体、居中、底边 y≈880），FLUX depth 锁菱形地砖形状。
"""
from PIL import Image
import numpy as np
import os

SRC = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\swampbrick-new1.png'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_depth_templates', 'demon_floor_h.png')

im = Image.open(SRC).convert('RGBA')
a = np.array(im)[:, :, 3]
ys, xs = np.nonzero(a > 8)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
body = im.crop((x0, y0, x1 + 1, y1 + 1)).convert('L')

SIZE = 1024
BOTTOM = 880
scale = min(1.0, SIZE * 0.9 / max(body.size))
body = body.resize((max(1, int(body.width * scale)), max(1, int(body.height * scale))), Image.LANCZOS)

canvas = Image.new('L', (SIZE, SIZE), 0)
px = (SIZE - body.width) // 2
py = BOTTOM - body.height
canvas.paste(body, (px, py))
canvas.save(OUT)
print('saved', OUT, canvas.size)
