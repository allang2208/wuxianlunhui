#!/usr/bin/env python3
"""Check for white halo / edge artifacts on the processed icons."""

import os

import numpy as np
from PIL import Image

FOLDER = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"
FILES = ["流云轻盔.png", "流云轻甲.png", "流云轻靴.png",
         "蚀月法帽.png", "蚀月法袍.png", "蚀月长靴.png",
         "镇岳重盔.png", "镇岳重甲.png", "镇岳重靴.png",
         "星陨之戒.png", "不息腰带.png", "磐心项链.png"]

for f in FILES:
    a = np.asarray(Image.open(os.path.join(FOLDER, f))).astype(np.int16)
    alpha = a[..., 3]
    edge = (alpha > 10) & (alpha < 245)
    if edge.sum() == 0:
        print(f"{f}: no edge px (hard alpha)")
        continue
    rgb = a[..., :3][edge]
    white = ((rgb >= 235).all(axis=1)).mean() * 100
    print(f"{f}: edge_px={edge.sum()} white-ish={white:.1f}% meanRGB={tuple(rgb.mean(axis=0).round(0).astype(int))}")
