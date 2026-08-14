#!/usr/bin/env python3
"""防御塔机械臂旋转帧打包 + 标定：合并 N 帧 → 水平 spritesheet（统一包围盒），
计算帧内枢轴像素（相机固定 + 模型绕枢轴旋转 → 枢轴投影恒定点），输出标定 JSON。
供 GameScene 按 aimAngle 选帧 + 椭圆臂尖（reach/dz）挂载武器。

相机约定与 render-defense-tower-frames.py 一致：ortho k=2.56px/unit、target=(20,0,177)。
枢轴渲染像素 = (512 + k*(0-20), 512 - k*(0.5*0 + 0.866*(177-177))) = (460.8, 512)。
"""
from PIL import Image
import numpy as np
import json
import os

SRC_DIR = r'Y:\工作\无尽轮回\scratch\world122\arm_frames'
DEST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\obstacle_defense_tower_arm_frames.png'
CALIB = r'Y:\工作\无尽轮回\scratch\world122\arm_frames_calib.json'
FRAMES = 48
Z_PIVOT = 177.0
REACH = 50.0   # 腕部挂载 x（模型单位）
DZ = 0.0       # 挂载件中心 z - 枢轴 z（简版：挂载件与枢轴同高）
K = 2.56       # 渲染 px/unit（ortho_scale=400 @1024）

imgs = []
for i in range(FRAMES):
    p = os.path.join(SRC_DIR, f'frame_{i:03d}.png')
    im = Image.open(p).convert('RGBA')
    a = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    imgs.append((im, xs.min(), ys.min(), xs.max(), ys.max()))

x0 = min(b[1] for b in imgs)
y0 = min(b[2] for b in imgs)
x1 = max(b[3] for b in imgs)
y1 = max(b[4] for b in imgs)
fw, fh = x1 - x0 + 1, y1 - y0 + 1
print(f'union bbox=({x0},{y0},{x1},{y1}) frame=({fw}x{fh})')

sheet = Image.new('RGBA', (fw * FRAMES, fh), (0, 0, 0, 0))
for i, (im, _, _, _, _) in enumerate(imgs):
    sheet.paste(im.crop((x0, y0, x1 + 1, y1 + 1)), (i * fw, 0))
sheet.save(DEST)
print('saved ->', DEST)

pivot_render = (512 + K * (0 - 20), 512 - K * (0.5 * 0 + 0.866 * (Z_PIVOT - Z_PIVOT)))
pivot = (round(pivot_render[0] - x0), round(pivot_render[1] - y0))
game_per_unit = 170.0 / (324.0 / K)
game_scale = game_per_unit / K
calib = {
    'frames': FRAMES,
    'frameW': int(fw),
    'frameH': int(fh),
    'pivot': {'x': int(pivot[0]), 'y': int(pivot[1])},
    'pivotWorldY': 235,
    'reach': float(REACH),
    'dz': float(DZ),
    'k': float(K),
    'gameScale': round(game_scale, 6),
    'displayW': int(round(fw * game_scale)),
    'displayH': int(round(fh * game_scale)),
}
with open(CALIB, 'w', encoding='utf-8') as fh:
    json.dump(calib, fh, ensure_ascii=False, indent=1)
print('CALIB ->', CALIB)
print(json.dumps(calib, ensure_ascii=False, indent=1))
