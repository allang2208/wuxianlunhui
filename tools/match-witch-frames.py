# -*- coding: utf-8 -*-
# 用源单帧 PNG 与 sheet 模板匹配，精确定位每帧在 sheet 中的格子位置
import os
from PIL import Image
import numpy as np

SRC = r"E:\无尽轮回\游戏\素材库\怪物\僵尸巫婆"
PROJ = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies\witch"

def frame_files(d):
    return sorted(f for f in os.listdir(os.path.join(SRC, d)) if f.endswith(".png"))

# 先看单帧尺寸
for d in ["walking", "dying", "attacking", "attacking-2"]:
    files = frame_files(d)
    im = Image.open(os.path.join(SRC, d, files[0]))
    print(d, "frames:", len(files), "first size:", im.size)

# 模板匹配：对每张 sheet，把每个源帧与 4x8 格子逐一比较（缩略后比 alpha 直方/像素差）
def best_cell(sheet_path, frame_path, cols=4, rows=8):
    sheet = Image.open(sheet_path).convert("RGBA")
    w, h = sheet.size
    cw, ch = w // cols, h // rows
    fr = Image.open(frame_path).convert("RGBA")
    # 帧可能小于格子：取帧自身 bbox 内容缩放到格子缩略尺寸比较
    fb = fr.crop(fr.getbbox()) if fr.getbbox() else fr
    fb = fb.resize((128, 32))
    fa = np.asarray(fb, dtype=np.int16)
    best = (None, 1e18)
    for i in range(cols * rows):
        cell = sheet.crop(((i % cols) * cw, (i // cols) * ch, (i % cols + 1) * cw, (i // cols + 1) * ch))
        cb = cell.crop(cell.getbbox()) if cell.getbbox() else cell
        cb = cb.resize((128, 32))
        ca = np.asarray(cb, dtype=np.int16)
        diff = np.abs(ca - fa).mean()
        if diff < best[1]:
            best = (i, diff)
    return best

for name, d in [("walking", "walking"), ("dying", "dying"), ("attacking", "attacking"), ("attacking-2", "attacking-2")]:
    sheet = os.path.join(PROJ, name + ".png")
    files = frame_files(d)
    cells = []
    for f in files:
        cell, diff = best_cell(sheet, os.path.join(SRC, d, f))
        cells.append(cell)
    print(name, "-> sheet cells in source order:", cells)
