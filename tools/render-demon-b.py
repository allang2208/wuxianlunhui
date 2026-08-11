# -*- coding: utf-8 -*-
"""路线 B 渲染驱动：地砖 1 次 + 闸门 16 帧（铁栅程序化升起）→ 4×4 打包 demon_gate.png。
依赖：Blender + render-cover-real.py（已支持 gate_bars_rise / tex2 双材质 / 铁栅不参与取景）。
"""
import json
import os
import subprocess

from PIL import Image
import numpy as np

BLENDER = r'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
ROOT = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev'
SCRIPT = os.path.join(ROOT, 'tools/ai-gen/render-cover-real.py')
SPEC_DIR = os.path.join(ROOT, 'tools/ai-gen/_blockout_specs')
ROCK = r'Y:/工作/无尽轮回/scratch/demon_rock_tex.png'
IRON = r'Y:/工作/无尽轮回/scratch/demon_iron_tex.png'
SCRATCH = r'Y:/工作/无尽轮回/scratch'
FRAME_DIR = os.path.join(SCRATCH, 'demon_gate_frames_B')
os.makedirs(FRAME_DIR, exist_ok=True)


def render(spec_path, tex, out):
    subprocess.run(
        [BLENDER, '--background', '--factory-startup', '--python', SCRIPT, '--', spec_path, tex, out],
        check=True, capture_output=True,
    )
    print('rendered', out)


# 1. 地砖
render(os.path.join(SPEC_DIR, 'demon_floor_b.json'), ROCK, os.path.join(SCRATCH, 'demon_floor_B.png'))

# 2. 闸门 16 帧
base = json.load(open(os.path.join(SPEC_DIR, 'demon_gate_b.json'), encoding='utf-8'))
frames = []
for i in range(16):
    spec = dict(base)
    spec['gate_bars_rise'] = i / 15
    sp = os.path.join(FRAME_DIR, f'spec_{i}.json')
    json.dump(spec, open(sp, 'w', encoding='utf-8'))
    fp = os.path.join(FRAME_DIR, f'frame_{i:02d}.png')
    render(sp, ROCK, fp)
    frames.append(Image.open(fp).convert('RGBA'))

# 3. 打包：并集包围盒对齐 → 统一格 → 4×4
arrs = [np.array(f) for f in frames]
x0, y0, x1, y1 = 10 ** 9, 10 ** 9, 0, 0
for a in arrs:
    ys, xs = np.nonzero(a[:, :, 3] > 8)
    x0, y0 = min(x0, xs.min()), min(y0, ys.min())
    x1, y1 = max(x1, xs.max()), max(y1, ys.max())
CELL_W = 640
CELL_H = int((y1 - y0 + 1) * CELL_W / (x1 - x0 + 1))
print('union bbox', (x0, y0, x1, y1), 'cell', CELL_W, CELL_H)
sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))
for i, a in enumerate(arrs):
    im = Image.fromarray(a).crop((x0, y0, x1 + 1, y1 + 1)).resize((CELL_W, CELL_H), Image.LANCZOS)
    sheet.paste(im, ((i % 4) * CELL_W, (i // 4) * CELL_H))
out_sheet = os.path.join(ROOT, 'assets/terrain/demon_gate.png')
sheet.save(out_sheet)
print('saved', out_sheet, sheet.size)
print(f'register geo: demon_gate w={CELL_W} h={CELL_H} frames=16')
