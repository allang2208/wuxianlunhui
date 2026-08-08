#!/usr/bin/env python3
"""世界-122 防御塔机械臂重新抠图（2026-08-06）。

背景：
- 旧 `obstacle_defense_tower_arm.png`（347x64）是错误地把塔顶平板左半段当成了手臂，
  与当前塔图（obstacle_defense_tower.png）对不上（IoU~0.68），实机显示是"一块板 + 竖条"。
- 真实机械臂是塔身左侧的独立大结构：x∈[0,116]、y∈[262,463]
  （肩部在塔身左上方、垂直臂身、末端双爪钳），与塔身之间有 2~13px 空隙。

本脚本：
1. 从塔图按实测区域抠出机械臂（矩形裁剪 + 最大连通域，剔除塔身角料碎屑）；
2. 从基座擦除手臂区，对 y262~290 的塔身左缘过渡带做对角 inpaint 修复；
3. 输出新 `obstacle_defense_tower_arm.png` 与 `obstacle_defense_tower.png`，
   并打印 DEFENSE_TOWER_VISUAL 需要的几何（枢轴/挂载点/自然角）。

用法：python tools/ai-gen/cut-defense-tower-arm.py [--dry-run]
"""
import argparse
import os
import shutil
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOWER_PATH = os.path.join(REPO, "assets", "terrain", "obstacle_defense_tower.png")
ARM_PATH = os.path.join(REPO, "assets", "terrain", "obstacle_defense_tower_arm.png")

# 实测手臂区域（塔图纹理坐标，2026-08-06 像素审计定稿）
ARM_X0, ARM_X1 = 0, 116
ARM_Y0, ARM_Y1 = 240, 463   # y 从 240 起：包含塔身上沿的机械臂尖端（y240~262）

# 枢轴 = 肩部上沿中心（塔图坐标）
PIVOT = (80, 268)
# 挂载点 = 双爪钳抓握中心（塔图坐标）
TIP = (47, 395)


def bbox_of_alpha(alpha, pad=2):
    ys, xs = np.where(alpha > 40)
    if len(xs) == 0:
        return None
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(alpha.shape[1], xs.max() + 1 + pad), min(alpha.shape[0], ys.max() + 1 + pad))


def inpaint_strip(img_rgba, mask):
    """cv2.inpaint（TELEA）填补掩码区域，返回 RGBA numpy。"""
    bgr = cv2.cvtColor(img_rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    m = (mask > 0).astype(np.uint8) * 255
    fixed = cv2.inpaint(bgr, m, 3, cv2.INPAINT_TELEA)
    out = img_rgba.copy()
    out[:, :, :3] = cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB)
    out[:, :, 3] = np.where(mask > 0, 255, out[:, :, 3])
    return out


def erase_arm_rect(img_rgba):
    """擦除手臂区：
    - y∈[240,262]：x∈[0,88]（机械臂尖端；塔身左上角 x88+ 保留）
    - y∈[262,463]：x∈[0,116]（肩/臂/爪）
    并对 y262~290 过渡带做对角修复。
    """
    x0, x1, y0, y1 = 0, 116, 262, 463
    out = img_rgba.copy()
    # 尖端区（y240~262，x0~88）
    out[240:262, 0:89, 3] = 0
    # 肩/臂/爪区
    out[y0:y1, x0:x1, 3] = 0
    # 过渡带缺口：y262..290，x∈[edge(y), 116]（塔身左缘从 x88 过渡到 x116）
    mask = np.zeros((img_rgba.shape[0], img_rgba.shape[1]), dtype=np.uint8)
    for y in range(y0, 291):
        edge = round(88 + (y - 262) * (116 - 88) / 28)
        mask[y, edge:x1] = 1
    out = inpaint_strip(out, mask)
    # 对角边以左恢复透明（防止 inpaint 向外加宽塔身）
    for y in range(y0, 291):
        edge = round(88 + (y - 262) * (116 - 88) / 28)
        out[y, x0:edge, 3] = 0
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印几何，不写文件")
    args = ap.parse_args()

    if not os.path.exists(TOWER_PATH):
        print("tower texture not found:", TOWER_PATH)
        sys.exit(1)
    full = Image.open(TOWER_PATH).convert("RGBA")
    arr = np.array(full)
    print("tower:", full.size)

    # ---- 1) 抠手臂：矩形裁剪 + 最大连通域 ----
    arm_raw = arr[ARM_Y0:ARM_Y1, ARM_X0:ARM_X1].copy()
    alpha = arm_raw[:, :, 3]
    lab, n = ndimage.label(alpha > 40)
    sizes = ndimage.sum(alpha > 40, lab, range(1, n + 1))
    keep = np.argmax(sizes) + 1 if n else 0
    if keep:
        arm_raw[lab != keep] = 0
    bb = bbox_of_alpha(arm_raw[:, :, 3])
    print("arm alpha bbox (x0,y0,x1,y1):", bb, " size:", (bb[2]-bb[0], bb[3]-bb[1]))
    arm_img = Image.fromarray(arm_raw[bb[1]:bb[3], bb[0]:bb[2]])

    # ---- 2) 基座擦除 + 过渡带修复 ----
    base = erase_arm_rect(arr)

    # ---- 3) 保存 ----
    if args.dry_run:
        print("dry-run: 不写文件")
        return

    backup_dir = os.path.join(REPO, "assets", "terrain", ".bak-tower-arm-20260806")
    os.makedirs(backup_dir, exist_ok=True)
    if os.path.exists(ARM_PATH):
        shutil.copy2(ARM_PATH, os.path.join(backup_dir, "obstacle_defense_tower_arm.old.png"))
    shutil.copy2(TOWER_PATH, os.path.join(backup_dir, "obstacle_defense_tower.old.png"))
    print("backup ->", backup_dir)

    arm_img.save(ARM_PATH)
    Image.fromarray(base).save(TOWER_PATH)
    print("saved:", ARM_PATH, arm_img.size)
    print("saved:", TOWER_PATH)

    # ---- 4) 几何输出（写进 DEFENSE_TOWER_VISUAL）----
    tw, th = arm_img.size
    px, py = PIVOT[0] - ARM_X0 - bb[0], PIVOT[1] - ARM_Y0 - bb[1]
    tx, ty = TIP[0] - ARM_X0 - bb[0], TIP[1] - ARM_Y0 - bb[1]
    nat = float(np.arctan2(ty - py, tx - px))
    print()
    print("=== DEFENSE_TOWER_VISUAL.arm (texture %d x %d) ===" % (tw, th))
    print("tw: %d, th: %d" % (tw, th))
    print("pivot: { x: %d, y: %d }" % (px, py))
    print("tip: { x: %d, y: %d }" % (tx, ty))
    print("naturalAngle: %.4f   # %.1f deg" % (nat, np.degrees(nat)))
    py_tower = PIVOT[1]
    print("pivotWorldY: %.2f" % (262 - py_tower * 262 / 832))
    s = 170 / 539
    print("s: %.4f   w: %.2f   h: %.2f" % (s, tw * s, th * s))


if __name__ == "__main__":
    main()
