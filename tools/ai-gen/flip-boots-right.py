#!/usr/bin/env python3
"""Mirror the single boots horizontally so they all face right."""

import os

from PIL import Image

DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"
# zhenyue was accidentally flipped from correct(right) to left; flip it back.
# Others are already correct (verified by pixel analysis) - skip them.
FILES = ["镇岳重靴.png"]

for f in FILES:
    p = os.path.join(DIR, f)
    im = Image.open(p)
    im.transpose(Image.FLIP_LEFT_RIGHT).save(p)
    print("flipped", f)
