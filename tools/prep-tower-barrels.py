#!/usr/bin/env python3
"""防御塔武器枪管预裁剪（2026-08-14）：把每把塔载武器贴图的前 1/3 枪管段
裁成独立小贴图，避免运行时 setCrop 与旋转/origin 的渲染兼容问题（"看不到枪械贴图"根因）。

产出：assets/terrain/tower_barrel_<weaponId>.png（枪管段，透明底）。
裁剪框与 DEFENSE_TOWER_VISUAL.weapon.barrel 的 w/h 对应（代码只读 w/h/height/inset）。
"""
from PIL import Image
import os

OUT = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain'
WEAPONS = {
    # weaponId: (贴图路径, 裁剪框 x,y,w,h)
    'weapon6':  (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\pkm_side_clean.png', (1326, 950, 619, 149)),
    'weapon7':  (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\weapons\akm-equip.png', (1337, 884, 623, 183)),
    'weapon21': (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\weapons\m416-equip.png', (1334, 828, 623, 193)),
    'weapon8':  (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\191icon.png', (1335, 586, 625, 251)),
    'weapon11': (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\201-icon.png', (1325, 916, 619, 151)),
    'weapon12': (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\M4s90_icon.png', (1335, 1010, 625, 175)),
    'weapon13': (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\S12k-icon.png', (1335, 500, 625, 283)),
    'weapon15': (r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\devotion-icon.png', (1335, 886, 625, 381)),
}

for wid, (src, box) in WEAPONS.items():
    im = Image.open(src).convert('RGBA')
    x, y, w, h = box
    crop = im.crop((x, y, x + w, y + h))
    dst = os.path.join(OUT, f'tower_barrel_{wid}.png')
    crop.save(dst)
    print(f'{wid}: {w}x{h} -> {dst}')
