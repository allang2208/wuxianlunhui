#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json, io, math
wp = json.load(io.open(r'data/wall-prefabs.json', encoding='utf-8'))
for key, p in wp.items():
    bad = 0
    for pc in p.get('pieces', []):
        for f in ['x', 'y', 'scaleX', 'scaleY', 'depth', 'rotation']:
            if f in pc:
                v = pc[f]
                if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                    bad += 1
                    print('BAD', key, pc.get('tex'), f, v)
    if '通道' in key:
        print(key, 'pieces:', len(p.get('pieces', [])), 'bad values:', bad)
