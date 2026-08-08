#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json, io

for p in [r'data/dungeon-config.json', r'public/data/dungeon-config.json']:
    d = json.load(io.open(p, encoding='utf-8'))
    if 'swampDungeon' not in d:
        d['swampDungeon'] = {}
    d['swampDungeon']['mapBackground'] = 'assets/scenes/dungeon-map-bg-swamp.png'
    # 清理误写的 dungeonList 条目键（'swamp' 是 dungeonList 键，mapBackground 无效）
    if isinstance(d.get('swamp'), dict):
        d['swamp'].pop('mapBackground', None)
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print('set', p, '->', d['swampDungeon'].get('mapBackground'))
