# -*- coding: utf-8 -*-
"""一次性脚本：测量精灵图怪物首帧内容边界，推导投射物躯干矩形（屏幕像素）。

输出每个怪物的建议 render.projectileHitbox 值：
  width/height = 内容宽高 × (spriteSize / frameWidth)
  offsetX      = 内容中心相对帧中心 × scale
  bottom       = 0（锚定脚底）
"""
from PIL import Image
import os

BASE = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev"
ENEMIES = [
    # (key, sheet, frameW, frameH, cellCol, cellRow, spriteSize, defaultW, defaultH)
    ("zombie",        "assets/enemies/zombie/idle.png",         512, 512, 0, 0, 120, 30, 120),
    ("fatZombie",     "assets/enemies/fat_zombie/idle.png",     512, 512, 0, 0, 150, 60, 150),
    ("spitterZombie", "assets/enemies/spitter_zombie/idle.png", 512, 512, 0, 0, 90,  32, 90),
    ("zombieWizard",  "assets/enemies/zombie_wizard/idle.png",  512, 512, 0, 0, 120, 61, 120),
    ("mutant3",       "assets/enemies/mutant3/idle.png",        512, 512, 0, 0, 120, 80, 120),
    ("zombieDog",     "assets/enemies/zombie_dog_idle.png",     512, 512, 0, 0, 90,  80, 90),
    ("blackWolf",     "assets/enemies/black_wolf.png",          250, 215, 0, 0, 151, 133, 151),
]

for key, rel, fw, fh, cc, cr, ss, defw, defh in ENEMIES:
    path = os.path.join(BASE, rel)
    im = Image.open(path).convert("RGBA")
    cell = im.crop((cc * fw, cr * fh, (cc + 1) * fw, (cr + 1) * fh))
    b = cell.getchannel("A").getbbox()
    if not b:
        print(f"{key}: NO CONTENT")
        continue
    cw, ch = b[2] - b[0], b[3] - b[1]
    scale = ss / fw
    w = round(cw * scale)
    h = round(ch * scale)
    ox = round(((b[0] + b[2]) / 2 - fw / 2) * scale)
    bottom_gap = fh - b[3]  # 内容底部到帧底的距离（源图）
    print(f"{key}: content {cw}x{ch} -> screen {w}x{h}, offsetX {ox}, 帧底留白 {bottom_gap}px")
    print(f'   建议: "projectileHitbox": {{ "width": {w}, "height": {h}, "offsetX": {ox}, "bottom": 0 }}'
          f'   (默认: {defw}x{defh})')
