#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
矿工僵尸精灵图一次性处理（2026-07-23，v2 修正版）
- 源：素材库/怪物/矿工僵尸/{idie,walking,attacking,dying}.png（8列×4行 512×512 帧）
- v1 教训：逐帧按内容底边对齐是错的——walking 部分帧镐头低于脚底（内容底边 480+），
  其余帧内容底边即脚底（~383），逐帧对齐把镐头帧抬/压 100px 导致"不在一个水平线上"。
- 实测各表脚底基线本就一致（idle 382 / attacking 384-386 / walking ~383 / dying 386→400 倒地），
  无需任何对齐，仅复制（idie.png 改名 idle.png）。
- 输出：assets/enemies/miner_zombie/{idle,walking,attacking,dying}.png
"""
import os
import shutil

SRC = r"E:\无尽轮回\游戏\素材库\怪物\矿工僵尸"
OUT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies\miner_zombie"

FILES = {
    "idie.png": "idle.png",
    "walking.png": "walking.png",
    "attacking.png": "attacking.png",
    "dying.png": "dying.png",
}

os.makedirs(OUT, exist_ok=True)
for src_name, out_name in FILES.items():
    shutil.copyfile(os.path.join(SRC, src_name), os.path.join(OUT, out_name))
    print(f"copied: {out_name}")
print("done")
