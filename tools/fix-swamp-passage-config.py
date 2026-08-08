#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json, io
import shutil

for p in [r'data/dungeon-config.json', r'public/data/dungeon-config.json']:
    d = json.load(io.open(p, encoding='utf-8'))
    d['combatArena']['passagePrefabs']['swamp'] = '左右通道·沼泽'
    with io.open(p, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print('fixed', p, '->', d['combatArena']['passagePrefabs'])

shutil.copyfile(r'data/wall-prefabs.json', r'public/data/wall-prefabs.json')
for p in [r'data/wall-prefabs.json', r'public/data/wall-prefabs.json']:
    wp = json.load(io.open(p, encoding='utf-8'))
    key = '左右通道·沼泽'
    print(p, 'prefab exists:', key in wp, 'pieces:', len(wp.get(key, {}).get('pieces', [])))
