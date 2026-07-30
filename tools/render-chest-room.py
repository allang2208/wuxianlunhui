# -*- coding: utf-8 -*-
"""离线渲染宝箱房（预制原样平移）+ 玩家站位标记：排查门墙左侧遮挡"""
from PIL import Image
import json

PREFAB = json.load(open('data/wall-prefabs.json', encoding='utf-8'))['宝箱房']
BOUNDS = (4000, 4000)

# 预制几何中心（face 线段端点外接框）—— 简化：用件 x/y/scale 近似计算 texPointToWorld
# 直接复用 wall-system 的数值：用 node 计算件底边段
import subprocess
NODE = r'''
import { WallSystem } from '../src/world/wall-system.js';
import { readFileSync } from 'fs';
const lib = JSON.parse(readFileSync('../data/wall-prefabs.json', 'utf-8'));
const p = lib['宝箱房'];
const out = p.pieces.map(q => ({
    tex: q.tex, x: q.x, y: q.y, scaleX: q.scaleX ?? 1, scaleY: q.scaleY ?? q.scaleX ?? 1,
    flipX: !!q.flipX, depth: q.depth ?? q.y,
    segs: WallSystem._pieceBaseSegments(q).map(([a, b]) => [[a.x, a.y], [b.x, b.y]]),
}));
console.log(JSON.stringify(out));
'''
out = subprocess.run(['node', '--input-type=module', '-e', NODE], capture_output=True, text=True, cwd='tools')
lines = [l for l in out.stdout.strip().splitlines() if l.strip().startswith('[') or l.strip().startswith('{')]
pieces = json.loads(lines[-1])

minX = min(min(a[0], b[0]) for q in pieces for a, b in q['segs'])
maxX = max(max(a[0], b[0]) for q in pieces for a, b in q['segs'])
minY = min(min(a[1], b[1]) for q in pieces for a, b in q['segs'])
maxY = max(max(a[1], b[1]) for q in pieces for a, b in q['segs'])
pcx, pcy = (minX + maxX) / 2, (minY + maxY) / 2
ox, oy = BOUNDS[0] - pcx, BOUNDS[1] - pcy

TEX = {
    'wall_straight': ('assets/terrain/wall_straight.png', None),
    'wall_gate': ('assets/terrain/wall_gate.png', (640, 641)),
}
cache = {}
def get_tex(key, frame=None):
    path, grid = TEX[key]
    img = cache.get(path)
    if img is None:
        img = Image.open(path).convert('RGBA')
        cache[path] = img
    if grid and frame is not None:
        fw, fh = grid
        cols = img.width // fw
        return img.crop(((frame % cols) * fw, (frame // cols) * fh, (frame % cols + 1) * fw, (frame // cols + 1) * fh))
    return img

canvas = Image.new('RGBA', (8000, 8000), (10, 10, 14, 255))

# 玩家占位： idle 贴图帧0（脚底锚点）
player_img = Image.open('assets/player/dash_recover.png').convert('RGBA').crop((0, 0, 512, 512)).resize((128, 128), Image.LANCZOS)

# 站位：真实游戏位置——宝箱点(房内中心)、房内靠门、门洞中、房外
spots = [
    ('A 宝箱点', BOUNDS[0], BOUNDS[1]),
    ('B 房内靠门', BOUNDS[0] - 200, BOUNDS[1] + 80),
    ('C 门洞中', BOUNDS[0] - 350, BOUNDS[1] + 200),
    ('D 门右房内', BOUNDS[0] + 150, BOUNDS[1] + 150),
]
# 深度排序：墙件与玩家按 depth 混排渲染（玩家 depth=脚底 y+10）
renderables = []
# 先算各件深度（门墙用修复后规则）
depths = []
for q in pieces:
    depth = q['depth'] + oy
    depths.append(depth)
for i, q in enumerate(pieces):
    frame = 0 if q['tex'] == 'wall_gate' else None
    depth = depths[i]
    if q['tex'] == 'wall_gate':
        segs = q['segs'][0]
        gA = (segs[0][0] + ox, segs[0][1] + oy)
        min_y = min(segs[0][1], segs[1][1]) + oy
        h_wall = 290 * q['scaleY']
        depth = min_y - h_wall
        # 上端邻墙（共享 gA 端点）+0.1
        for j, q2 in enumerate(pieces):
            if j == i:
                continue
            for s2 in q2['segs']:
                for pt in s2:
                    if ((pt[0] + ox - gA[0]) ** 2 + (pt[1] + oy - gA[1]) ** 2) ** 0.5 < 40:
                        depth = max(depth, depths[j] + 0.1)
        print('gate new depth =', round(depth, 1))
    renderables.append((depth, 'wall', q, frame))
for name, px, py in spots:
    renderables.append((py + 10, 'player', (name, px, py), None))
renderables.sort(key=lambda r: r[0])

for _, kind, obj, frame in renderables:
    if kind == 'wall':
        q = obj
        img = get_tex(q['tex'], frame)
        w = max(1, round(img.width * abs(q['scaleX'])))
        h = max(1, round(img.height * q['scaleY']))
        img = img.resize((w, h), Image.LANCZOS)
        if q['flipX']:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        canvas.alpha_composite(img, (round(q['x'] + ox - w / 2), round(q['y'] + oy - h / 2)))
    else:
        name, px, py = obj
        canvas.alpha_composite(player_img, (round(px - 64), round(py - 118)))

x0, y0 = int(BOUNDS[0] - 700), int(BOUNDS[1] - 450)
canvas.crop((x0, y0, x0 + 1400, y0 + 1100)).save('tools/normalized/chest_room_sim.png')
print('saved tools/normalized/chest_room_sim.png')
for name, px, py in spots:
    print(name, 'player depth =', py + 10)
for q in pieces:
    print(q['tex'], 'piece depth =', round(q['depth'] + oy, 1))
