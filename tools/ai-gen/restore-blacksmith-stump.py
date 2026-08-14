# -*- coding: utf-8 -*-
"""从 raw 图把棕色木桩底座补回透明图（2026-08-11）：
BiRefNet 抠图把铁匠脚下木桩误当背景删掉；本脚本用紫色背景距离阈值
从 raw 底部区域单独抠出木桩，合并进透明图（max alpha，RGB 取 raw）。
"""
import numpy as np
from PIL import Image

import sys

RAW = sys.argv[1] if len(sys.argv) > 1 else r"Y:\工作\无尽轮回\scratch\blacksmith_front_v2_raw.png"
FINAL = sys.argv[2] if len(sys.argv) > 2 else r"Y:\工作\无尽轮回\scratch\blacksmith_front_v2.png"
OUT = sys.argv[3] if len(sys.argv) > 3 else r"Y:\工作\无尽轮回\scratch\blacksmith_front_v2b.png"
DIST = 70.0

raw = np.array(Image.open(RAW).convert("RGBA")).astype(np.float64)
fin = np.array(Image.open(FINAL).convert("RGBA"))
out = fin.copy()

# 自动检测背景色：取四角像素均值
h, w = raw.shape[:2]
corners = np.array([raw[3, 3, :3], raw[3, w - 4, :3], raw[h - 4, 3, :3], raw[h - 4, w - 4, :3]])
BG = corners.mean(axis=0)
print("detected bg color: #%02X%02X%02X" % (int(BG[0]), int(BG[1]), int(BG[2])))

# 木桩所在底部区域（含两侧延伸）
y0, y1 = 880, 1024
x0, x1 = 300, 724
for y in range(y0, y1):
    for x in range(x0, x1):
        px = raw[y, x, :3]
        d = np.linalg.norm(px - BG)
        if d > DIST:
            out[y, x, :3] = px
            out[y, x, 3] = max(int(out[y, x, 3]), 255)

Image.fromarray(out).save(OUT)
added = int(np.sum(out[y0:y1, x0:x1, 3] > 40)) - int(np.sum(fin[y0:y1, x0:x1, 3] > 40))
print("saved", OUT, "| 底部新增不透明像素(采样):", added)

# 灰底预览（浅灰 180，模拟游戏地板观感，检查边缘/白边）
preview = OUT.replace(".png", "_preview.png")
bg = np.full((out.shape[0], out.shape[1], 4), 180, dtype=np.uint8)
bg[:, :, 3] = 255
aa = (out[:, :, 3:4].astype(np.float64) / 255.0)
comp = (out[:, :, :3].astype(np.float64) * aa + bg[:, :, :3].astype(np.float64) * (1 - aa)).astype(np.uint8)
comp = np.dstack([comp, np.full((out.shape[0], out.shape[1]), 255, dtype=np.uint8)])
Image.fromarray(comp).save(preview)
print("preview saved", preview)
