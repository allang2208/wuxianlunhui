# -*- coding: utf-8 -*-
"""离线渲染战斗房墙件布局（与 JS 同数学）：对比门闸替换前后下夹角视觉"""
from PIL import Image
import numpy as np
import subprocess, json, sys

# 从 node 拿墙件数据（替换前后两组）
NODE_SCRIPT = r'''
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf } from '../src/world/wall-system.js';
const S = 1792, rx = 1.2 * S, ry = rx * 0.5774;
const cx = 4000, cy = 4000;
const player = { x: cx, y: cy + ry - 80 };
WallSystem.setWallStyle('default');
WallSystem.isoVisuals = []; WallSystem.isoSegments = [];
WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry);
const straightTex = ISO_WALL_GEO.straight.tex;
const g0 = ISO_WALL_GEO.straight;
const s0 = ISO_WALL_HEIGHT / g0.wallH, sy0 = s0 * slopeFixOf(g0);
const faceLen0 = Math.hypot((g0.face[1][0] - g0.face[0][0]) * s0, (g0.face[1][1] - g0.face[0][1]) * sy0);
const verts = [{ x: cx, y: cy - ry }, { x: cx, y: cy + ry }, { x: cx - rx, y: cy }, { x: cx + rx, y: cy }];
const nearVertex = (p) => {
    const seg = WallSystem._pieceBaseSegments(p)[0];
    if (!seg) return true;
    return seg.some(pt => verts.some(V => Math.hypot(pt.x - V.x, pt.y - V.y) < 0.8 * faceLen0));
};
let best = null, bestD = Infinity;
for (const p of WallSystem.isoVisuals) {
    if (p.tex !== straightTex || p._corner || nearVertex(p)) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d < bestD) { bestD = d; best = p; }
}
const [A0, Bb] = WallSystem._pieceBaseSegments(best)[0];
// 与 _setupGate 同口径：锚点沿边回退 8px
const _l = Math.hypot(Bb.x - A0.x, Bb.y - A0.y) || 1;
const A = { x: A0.x - (Bb.x - A0.x) / _l * 8, y: A0.y - (Bb.y - A0.y) / _l * 8 };
const before = WallSystem.isoVisuals.map(p => ({ tex: p.tex, x: p.x, y: p.y, scaleX: p.scaleX, scaleY: p.scaleY, flipX: !!p.flipX, depth: p.depth }));
// 门闸件（替换后）：placeAt 同款映射，贴图=wall_gate 帧15
const g = ISO_WALL_GEO.gate;
const s = ISO_WALL_HEIGHT / g.wallH, sy = s * slopeFixOf(g);
const flip = !!best.flipX;
let x0, y0;
if (!flip) { x0 = A.x - g.base[0][0] * s; y0 = A.y - g.base[0][1] * sy; }
else { x0 = A.x - (g.w - g.base[0][0]) * s; y0 = A.y - g.base[0][1] * sy; }
WallSystem.isoVisuals.splice(WallSystem.isoVisuals.indexOf(best), 1);
WallSystem.removeSpanCoveringPieces([A0, Bb]);
const after = WallSystem.isoVisuals.map(p => ({ tex: p.tex, x: p.x, y: p.y, scaleX: p.scaleX, scaleY: p.scaleY, flipX: !!p.flipX, depth: p.depth }));
after.push({ tex: 'wall_gate', x: x0 + g.w * s / 2, y: y0 + g.h * sy / 2, scaleX: s, scaleY: sy, flipX: flip, depth: best.depth, gateFrame: 15 });
console.log(JSON.stringify({ before, after, cx, cy, rx, ry, gateCx: x0 + g.w * s / 2, gateCy: y0 + g.h * sy / 2 }));
'''
out = subprocess.run(['node', '--input-type=module', '-e', NODE_SCRIPT], capture_output=True, text=True, cwd='tools')
data = json.loads(out.stdout.strip().splitlines()[-1])

TEX = {
    'wall_straight': ('assets/terrain/wall_straight.png', None),
    'wall_gate': ('assets/terrain/wall_gate.png', (640, 641)),
}
tex_cache = {}
def get_tex(key, frame=None):
    path, grid = TEX[key]
    img = tex_cache.get(path)
    if img is None:
        img = Image.open(path).convert('RGBA')
        tex_cache[path] = img
    if grid and frame is not None:
        fw, fh = grid
        cols = img.width // fw
        fx, fy = (frame % cols) * fw, (frame // cols) * fh
        return img.crop((fx, fy, fx + fw, fy + fh))
    return img

def render(pieces, out_path):
    canvas = Image.new('RGBA', (8000, 8000), (10, 10, 14, 255))
    for p in sorted(pieces, key=lambda q: q['depth']):
        img = get_tex(p['tex'], p.get('gateFrame'))
        w = max(1, round(img.width * abs(p['scaleX'])))
        h = max(1, round(img.height * p['scaleY']))
        img = img.resize((w, h), Image.LANCZOS)
        if p['flipX']:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        canvas.alpha_composite(img, (round(p['x'] - w / 2), round(p['y'] - h / 2)))
    # 裁门所在区（门中心周围 1400×800）
    x0, y0 = int(data['gateCx'] - 500), int(data['gateCy'] - 400)
    canvas.crop((x0, y0, x0 + 1400, y0 + 800)).save(out_path)
    print('saved', out_path)

render(data['before'], 'tools/normalized/gate_before.png')
render(data['after'], 'tools/normalized/gate_after.png')
