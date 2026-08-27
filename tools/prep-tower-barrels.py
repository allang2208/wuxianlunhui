#!/usr/bin/env python3
"""防御塔武器枪管预裁剪（2026-08-14）：把每把塔载武器贴图的前 1/3 枪管段
裁成独立小贴图，避免运行时 setCrop 与旋转/origin 的渲染兼容问题（"看不到枪械贴图"根因）。

产出：assets/terrain/tower_barrel_<weaponId>.png（枪管段，透明底）。
裁剪框与 DEFENSE_TOWER_VISUAL.weapon.barrel 的 w/h 对应（代码只读 w/h/height/inset）。
"""
from PIL import Image
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'terrain')
WEAPONS = {
    # weaponId: (贴图路径, 裁剪框 x,y,w,h)
    'weapon6':  (os.path.join(ROOT, 'assets', 'icons', 'pkm_side_clean.png'), (1326, 950, 619, 149)),
    'weapon31': (os.path.join(ROOT, 'assets', 'weapons', 'rpd-equip.png'), (1336, 863, 624, 498)),
    'weapon32': (os.path.join(ROOT, 'assets', 'weapons', 'm249-equip.png'), (1336, 832, 624, 560)),
    'weapon33': (os.path.join(ROOT, 'assets', 'weapons', 'ultimax100-equip.png'), (1336, 876, 624, 472)),
    'weapon34': (os.path.join(ROOT, 'assets', 'weapons', 'mg42-equip.png'), (1336, 999, 624, 150)),
    'weapon35': (os.path.join(ROOT, 'assets', 'weapons', 'fusion-core-lmg-equip.png'), (1336, 803, 624, 616)),
    'weapon36': (os.path.join(ROOT, 'assets', 'weapons', 'singularity-loom-lmg-equip.png'), (1335, 925, 625, 300)),
    'weapon7':  (os.path.join(ROOT, 'assets', 'weapons', 'akm-equip.png'), (1337, 884, 623, 183)),
    'weapon23': (os.path.join(ROOT, 'assets', 'weapons', 'stg44-equip.png'), (1336, 818, 624, 588)),
    'weapon21': (os.path.join(ROOT, 'assets', 'weapons', 'm416-equip.png'), (1334, 828, 623, 193)),
    'weapon24': (os.path.join(ROOT, 'assets', 'weapons', 'qbz95-equip.png'), (1336, 754, 624, 716)),
    'weapon25': (os.path.join(ROOT, 'assets', 'weapons', 'frontier-rifle-equip.png'), (1336, 870, 625, 310)),
    'weapon26': (os.path.join(ROOT, 'assets', 'weapons', 'vengeance-rifle-equip.png'), (1335, 900, 625, 300)),
    'weapon27': (os.path.join(ROOT, 'assets', 'weapons', 'astral-tide-rifle-equip.png'), (1335, 900, 625, 300)),
    'weapon28': (os.path.join(ROOT, 'assets', 'weapons', 'zero-point-arbitrator-equip.png'), (1335, 900, 625, 300)),
    'weapon29': (os.path.join(ROOT, 'assets', 'weapons', 'corona-cadence-rifle-equip.png'), (1335, 900, 625, 300)),
    'weapon30': (os.path.join(ROOT, 'assets', 'weapons', 'terminal-echo-rifle-equip.png'), (1335, 900, 625, 300)),
    'weapon8':  (os.path.join(ROOT, 'assets', 'icons', '191icon.png'), (1335, 586, 625, 251)),
    'weapon11': (os.path.join(ROOT, 'assets', 'icons', '201-icon.png'), (1325, 916, 619, 151)),
    'weapon12': (os.path.join(ROOT, 'assets', 'icons', 'M4s90_icon.png'), (1335, 1010, 625, 175)),
    'weapon13': (os.path.join(ROOT, 'assets', 'icons', 'S12k-icon.png'), (1335, 500, 625, 283)),
    'weapon15': (os.path.join(ROOT, 'assets', 'icons', 'devotion-icon.png'), (1335, 886, 625, 381)),
}

selected = sys.argv[1:] or list(WEAPONS)
unknown = [wid for wid in selected if wid not in WEAPONS]
if unknown:
    raise SystemExit(f'unknown weapon ids: {", ".join(unknown)}')

for wid in selected:
    src, box = WEAPONS[wid]
    im = Image.open(src).convert('RGBA')
    x, y, w, h = box
    crop = im.crop((x, y, x + w, y + h))
    dst = os.path.join(OUT, f'tower_barrel_{wid}.png')
    crop.save(dst)
    print(f'{wid}: {w}x{h} -> {dst}')
