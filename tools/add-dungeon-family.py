# -*- coding: utf-8 -*-
"""为僵尸家族地牢配置块补 family='zombie'（数据驱动，替代 _isZombieFamily 硬编码列表）。"""
import json
import io

PATH = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\data\dungeon-config.json'
PUBLIC = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\public\data\dungeon-config.json'

with io.open(PATH, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

for key in ['zombieDungeon', 'zombieDungeonBeginner', 'zombieDungeonMid', 'swampDungeon', 'demonCavern']:
    if key in cfg and cfg[key].get('family') is None:
        cfg[key]['family'] = 'zombie'
        print('family added:', key)

with io.open(PATH, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=1)
    f.write('\n')
import shutil
shutil.copyfile(PATH, PUBLIC)
print('synced to public/data')
