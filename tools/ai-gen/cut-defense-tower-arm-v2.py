#!/usr/bin/env python3
"""防御塔 v2（圆柱基座 + 顶部机械臂）抠臂入库（2026-08-06）。

输入：tools/ai-gen/_scratch/tower_v2b/raw_birefnet.png（BiRefNet 抠图定稿，保留肩部高光）
结构（像素实测）：法兰+臂段+肩部 y≈78~388；顶部安装盘+圆柱基座 y≈388~880。
⚠ 2026-08-07 修正：
- 原白底抠图把肩部近白高光（x400~460）当背景抠掉 → 臂肩出现洞，最大连通域把碎片丢了。
- 改用 BiRefNet 显著性抠图（不吃背景色假设），切割线下移到肩部细颈（y≈425），
  并对臂/基座做内部孔洞填充。
输出：
  - assets/terrain/obstacle_defense_tower_arm.png（机械臂，绕肩部枢轴 360° 旋转）
  - assets/terrain/obstacle_defense_tower.png（基座=圆柱+顶部安装盘，擦除手臂）
并打印 DEFENSE_TOWER_VISUAL.arm 几何。
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "tools", "ai-gen", "_scratch", "tower_v2b", "fc39ae_cut.png")
TOWER_OUT = os.path.join(REPO, "assets", "terrain", "obstacle_defense_tower.png")
ARM_OUT = os.path.join(REPO, "assets", "terrain", "obstacle_defense_tower_arm.png")

# 手臂区（含肩部细颈，到安装盘交界；fc39ae 定稿：颈 y412~424）
ARM_Y0, ARM_Y1 = 85, 425


def bbox_of_alpha(alpha, pad=2):
    ys, xs = np.where(alpha > 40)
    if len(xs) == 0:
        return None
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(alpha.shape[1], xs.max() + 1 + pad), min(alpha.shape[0], ys.max() + 1 + pad))


def main():
    full = Image.open(SRC).convert("RGBA")
    arr = np.array(full)
    print("source:", full.size)

    # ---- 1) 抠手臂：取 y[78,426] 区域（含肩部细颈）+ 孔洞填充 + 最大连通域 ----
    arm_raw = arr[ARM_Y0:ARM_Y1, :, :].copy()
    alpha = arm_raw[:, :, 3]
    # 修复 BiRefNet/白底抠图的内部孔洞（如肩部高光被误抠成洞）
    alpha_filled = ndimage.binary_fill_holes(alpha > 40)
    hole_mask = alpha_filled & ~(alpha > 40)
    arm_raw[:, :, 3] = np.where(hole_mask, 255, alpha)
    lab, n = ndimage.label(alpha_filled)
    sizes = ndimage.sum(alpha_filled, lab, range(1, n + 1))
    keep = np.argmax(sizes) + 1 if n else 0
    if keep:
        arm_raw[lab != keep] = 0
    bb = bbox_of_alpha(arm_raw[:, :, 3])
    if bb is None:
        print("arm empty!")
        sys.exit(1)
    print("arm alpha bbox (x0,y0,x1,y1):", bb, " size:", (bb[2]-bb[0], bb[3]-bb[1]))
    arm_img = Image.fromarray(arm_raw[bb[1]:bb[3], bb[0]:bb[2]])

    # ---- 2) 基座：全图擦除手臂区（保留安装盘+圆柱），裁到内容 bbox + 孔洞填充 ----
    base = arr.copy()
    base[ARM_Y0:ARM_Y1, bb[0]:bb[2], 3] = 0
    # 基座内部孔洞填充（同一套修复）
    base_alpha = base[:, :, 3]
    base_filled = ndimage.binary_fill_holes(base_alpha > 40)
    base_hole = base_filled & ~(base_alpha > 40)
    base[:, :, 3] = np.where(base_hole, 255, base_alpha)
    base_bb = bbox_of_alpha(base[:, :, 3], 2)
    base_img = Image.fromarray(base[base_bb[1]:base_bb[3], base_bb[0]:base_bb[2]])

    # ---- 3) 几何 ----
    # 枢轴 = 细颈底部中心（臂与安装盘的实际连接点，不用纹理中心——臂肩质量可能偏心）
    aw = bb[2] - bb[0]
    ah = bb[3] - bb[1]
    arm_alpha = arm_img.getchannel("A")
    aa = np.array(arm_alpha)
    # 细颈 = 底部 15% 行的最窄连续段（肩部以上收进颈）
    bottom = aa[int(ah * 0.85):, :] > 40
    ys, xs = np.where(bottom)
    neck_center_x = int(xs.mean())
    px, py = neck_center_x, ah - 1
    # 法兰 = 顶部 12% 行内容中心（宽盘）
    top = aa[:max(4, int(ah * 0.12)), :] > 40
    tys, txs = np.where(top)
    tx = int(txs.mean()) if len(txs) else aw // 2
    ty = int(tys.mean()) if len(tys) else 3
    nat = float(np.arctan2(ty - py, tx - px))

    # 保存
    arm_img.save(ARM_OUT)
    base_img.save(TOWER_OUT)
    print("saved:", ARM_OUT, arm_img.size)
    print("saved:", TOWER_OUT)

    # 显示几何（基座显示宽度按旧口径 170；比例由内容 bbox 推导）
    bw = base_img.size[0]
    bh = base_img.size[1]
    s = 170 / bw
    print()
    print("=== DEFENSE_TOWER_VISUAL ===")
    print(f"base content bbox: {base_bb} w={bw} h={bh} -> display 170 x {bh*s:.1f}  footOffsetY={bh*s/2:.1f}")
    print(f"arm tw={arm_img.size[0]} th={arm_img.size[1]}  display w={arm_img.size[0]*s:.1f} h={arm_img.size[1]*s:.1f}")
    print(f"pivot={{x:{px}, y:{py}}}  tip={{x:{tx}, y:{ty}}}  naturalAngle={nat:.4f}  ({np.degrees(nat):.1f} deg)")
    # pivotWorldY：枢轴在全图 y = ARM_Y0 + bb[1] + py；塔脚 = 内容底边 y
    pivot_full_y = ARM_Y0 + bb[1] + py
    foot_y = base_bb[3]
    print(f"pivotWorldY={((foot_y - pivot_full_y) * s):.1f}   # 塔脚到枢轴距离(显示px)")
    print(f"s={s:.4f}")


if __name__ == "__main__":
    main()
