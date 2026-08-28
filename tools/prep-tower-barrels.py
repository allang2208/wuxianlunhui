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
    'weapon39': (os.path.join(ROOT, 'assets', 'weapons', 's686-equip.png'), (831, 512, 397, 101)),
    'weapon40': (os.path.join(ROOT, 'assets', 'weapons', 'm870-breacher-equip.png'), (832, 466, 397, 167)),
    'weapon41': (os.path.join(ROOT, 'assets', 'weapons', 'ksg12-equip.png'), (836, 376, 405, 245)),
    'weapon42': (os.path.join(ROOT, 'assets', 'weapons', 'spas12-equip.png'), (836, 481, 401, 150)),
    'weapon43': (os.path.join(ROOT, 'assets', 'weapons', 'aa12-equip.png'), (1184, 130, 576, 277)),
    'weapon44': (os.path.join(ROOT, 'assets', 'weapons', 'winchester1887-equip.png'), (1337, 184, 640, 134)),
    'weapon45': (os.path.join(ROOT, 'assets', 'weapons', 'terminus-pendulum-equip.png'), (1443, 116, 701, 331)),
    'weapon46': (os.path.join(ROOT, 'assets', 'weapons', 'void-funeral-tide-equip.png'), (1448, 142, 703, 207)),
    'weapon47': (os.path.join(ROOT, 'tools', 'ai-gen', 'weapon-gen', 'shotgun-inventory-icons-20260828', 'black-sun-tower-side.png'), (831, 469, 395, 155)),
    'weapon48': (os.path.join(ROOT, 'assets', 'weapons', 'royal-hunt-finale-equip.png'), (1440, 173, 692, 152)),
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
