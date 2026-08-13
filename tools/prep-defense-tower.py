# -*- coding: utf-8 -*-
"""世界-122 防御塔新模型入库：裁剪内容包围盒 → 备份旧贴图 → 覆盖 assets/terrain。
输出标定值供 DEFENSE_TOWER_VISUAL 更新（base/arm 显示尺寸、枢轴、尖端、pivotWorldY）。"""
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
# 枢轴（机械臂枢轴柱中心，tex 裁剪后）
pivot = (178 - ab[0], 507 - ab[1])
# 尖端（腕部武器挂载中心）
tip = (806 - ab[0], 514 - ab[1])
display_w = round(arm_w / px_per_unit * game_per_unit)
display_h = round(arm_h / px_per_unit * game_per_unit)
pivot_world_y = round(175 * game_per_unit)
print(f'CALIB: arm display=({display_w},{display_h}) s={display_w / arm_w:.4f}')
print(f'CALIB: pivot={pivot} tip={tip} pivotWorldY={pivot_world_y} naturalAngle=0')
print(f'CALIB: base display=(170,262) footOffsetY=131')
