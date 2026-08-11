# -*- coding: utf-8 -*-
"""恶魔闸门预览：帧 0/7/15 拼在深色背景上 + 直墙 + 地砖，供 GLM 视觉验收。"""
from PIL import Image

SHEET = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'
WALL = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_wall_straight.png'
FLOOR = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demonbrick1.png'
OUT = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\verify-shots\demon_gate_preview.png'

sheet = Image.open(SHEET).convert('RGBA')
CW, CH = 640, sheet.height // 4
bg = Image.new('RGBA', (CW * 3 + 40, CH + 160), (34, 30, 26, 255))


def paste_frame(n, x):
    fx, fy = (n % 4) * CW, (n // 4) * CH
    fr = sheet.crop((fx, fy, fx + CW, fy + CH))
    bg.paste(fr, (x, 80), fr)


paste_frame(0, 0)
paste_frame(7, CW + 20)
paste_frame(15, CW * 2 + 40)

wall = Image.open(WALL).convert('RGBA')
wall.thumbnail((360, 360))
bg.paste(wall, (10, CH + 95), wall)

floor = Image.open(FLOOR).convert('RGBA')
floor.thumbnail((180, 180))
bg.paste(floor, (390, CH + 95), floor)

bg.convert('RGB').save(OUT)
print('saved', OUT, bg.size)
