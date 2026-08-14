# -*- coding: utf-8 -*-
"""世界-122 防御塔新模型入库：裁剪内容包围盒 → 备份旧贴图 → 覆盖 assets/terrain。
输出标定值供 DEFENSE_TOWER_VISUAL 更新（base/arm 显示尺寸、枢轴、尖端、pivotWorldY）。
2026-08-14：枢轴/尖端改为从渲染图自动检测——枢轴=肩座（最左内容带）质心，
尖端=accent 橙色挂载件质心；不再硬编码渲染像素，几何重做后无需改标定公式。"""
from PIL import Image
import numpy as np
import os
import shutil

SRC_BASE = r'Y:\工作\无尽轮回\scratch\world122\tower_base.png'
SRC_ARM = r'Y:\工作\无尽轮回\scratch\world122\tower_arm.png'
DST_BASE = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\obstacle_defense_tower.png'
DST_ARM = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\obstacle_defense_tower_arm.png'
BAK = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\.bak-tower-20260812'


def crop_content(path):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    ys, xs = np.nonzero(a[:, :, 3] > 8)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    c = Image.fromarray(a[y0:y1 + 1, x0:x1 + 1])
    return c, (x0, y0, x1, y1)


base, bb = crop_content(SRC_BASE)
print(f'base content {base.size} bbox={bb}')
arm, ab = crop_content(SRC_ARM)
print(f'arm content {arm.size} bbox={ab}')

os.makedirs(BAK, exist_ok=True)
for src, dst in [(DST_BASE, os.path.join(BAK, 'obstacle_defense_tower.png')),
                 (DST_ARM, os.path.join(BAK, 'obstacle_defense_tower_arm.png'))]:
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print('backup ->', dst)

base.save(DST_BASE)
arm.save(DST_ARM)
print('saved ->', DST_BASE, DST_ARM)

# 标定值（模型 2.56px/unit，游戏 1.343 game-px/unit）
arm_w, arm_h = arm.size
px_per_unit = 2.56
game_per_unit = 170.0 / (324.0 / px_per_unit)


def alpha_mask(im):
    a = np.array(im)[:, :, 3]
    return a


am = alpha_mask(arm)
ys, xs = np.nonzero(am > 8)
x_min, x_max = xs.min(), xs.max()
# 枢轴：最左内容带（肩座，取左 50px 内所有内容像素质心）
band = (xs <= x_min + 50) & (am[ys, xs] > 8)
pivot = (int(round(xs[band].mean())), int(round(ys[band].mean())))
# 尖端：accent 橙色挂载件质心（R>150, 70<G<170, B<90）；无则退化为最右内容
rgb = np.array(arm.convert('RGB'))
acc = (rgb[:, :, 0] > 150) & (rgb[:, :, 1] > 70) & (rgb[:, :, 1] < 170) & (rgb[:, :, 2] < 90) & (am > 8)
if acc.sum() > 20:
    ay, ax = np.nonzero(acc)
    tip = (int(round(ax.mean())), int(round(ay.mean())))
    print(f'[detect] accent pixels={acc.sum()} tip by accent centroid')
else:
    tail = (xs >= x_max - 24) & (am > 8)
    tip = (int(round(xs[tail].mean())), int(round(ys[tail].mean())))
    print('[detect] accent not found, tip by rightmost content')
print(f'[detect] pivot={pivot} tip={tip}')

display_w = round(arm_w / px_per_unit * game_per_unit)
display_h = round(arm_h / px_per_unit * game_per_unit)
import math
natural = math.degrees(math.atan2(tip[1] - pivot[1], tip[0] - pivot[0]))
# pivotWorldY：枢轴 z=177 模型单位 → 游戏 px（底座未变，沿用 235 视觉锚点；给出计算候选）
pivot_world_y = round(177 * game_per_unit)
print(f'CALIB: arm display=({display_w},{display_h}) s={display_w / arm_w:.4f}')
print(f'CALIB: pivot={pivot} tip={tip} naturalAngle={natural:.4f}°(rad {math.atan2(tip[1] - pivot[1], tip[0] - pivot[0]):.4f}) pivotWorldY={pivot_world_y}')
print(f'CALIB: base display=(170,262) footOffsetY=131')
