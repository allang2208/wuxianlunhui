# -*- coding: utf-8 -*-
"""向 data/dungeon-config.json 插入 C 级「恶魔洞窟」（demonCavern）地牢配置。
以 swampDungeon（同 C 级）为模板；地砖键 demonbrick1（矿洞岩板，素材另生成）。
"""
import json
import io

PATH = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\data\dungeon-config.json'

with io.open(PATH, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

if 'demonCavern' in cfg:
    print('demonCavern already present, skip')
    raise SystemExit(0)

cfg['dungeonList']['demonCavern'] = {
    'name': '☠ 恶魔洞窟',
    'nodeCount': '55~60',
    'battleRatio': '50%',
    'level': '1级',
    'reward': '2000金币',
    'grade': 'C',
    'recLevel': '40~55级',
}

cfg['demonCavern'] = {
    'combatRoom': {'bossSize': 1024},
    'nodeCount': {'min': 55, 'max': 60},
    'shortestCombatPath': 5,
    'typeRatios': {'combat': 0.5, 'event': 0.5},
    'eliteCombatChance': 0.35,
    'encounters': {
        'normal': {
            'combatWaves': 3,
            'monstersPerWave': 5,
            'tierWeights': {'normal': 1, 'elite': 0},
            'guaranteeAtLeastOneElite': False,
            'waveComposition': [{'normal': 5}, {'normal': 5}, {'normal': 4, 'elite': 1}],
        },
        'elite': {
            'combatWaves': 3,
            'monstersPerWave': 5,
            'monsterComposition': {'elite': 1, 'normal': 5},
            'tierWeights': {'normal': 0, 'elite': 1},
            'guaranteeAtLeastOneElite': False,
            'waveComposition': [{'normal': 5}, {'normal': 5}, {'normal': 4, 'lord': 1}],
        },
    },
    'grid': {'rows': 4, 'colSpacing': 160, 'rowSpacing': 140, 'mainRow': 1},
    'startRows': [0, 1, 2, 3],
    'bossReward': {'bossBeforeLastCol': True, 'rewardAfterBoss': True},
    'nodeDisplay': {'unrevealedIcon': '?', 'completedCombatType': 'empty'},
    'minRoomsToBoss': 7,
    'floor': {'tiles': ['demonbrick1'], 'glow': False, 'overlapX': 6, 'overlapY': 3},
    'mapBackground': 'assets/scenes/dungeon-map-bg.png',
}

with io.open(PATH, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=1)
    f.write('\n')

print('demonCavern inserted OK')
