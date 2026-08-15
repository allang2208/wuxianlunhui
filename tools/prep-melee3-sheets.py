#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
三段近战连段（挥击×2 + 突刺×1）素材定稿管线 —— 可重复运行
v2（2026-08-13 二轮，用户反馈：双手→单手、僵硬、要前移）：
  源 Y:/工作/无尽轮回/scratch/player_melee3/{slash1,slash2,thrust}_sheet_v2.png
  差异：单手握剑姿态、挥砍段加密选帧、保留逐帧前移位移（--keep-dx：首帧 cx≈210 偏左，
  后续帧含 +25/+128/+66px 格内位移——格内不居中即屏显前移，GameScene origin 中心锚定下
  无需代码改动；武器轨迹 seed 以 v1 身体为基准，DevTool 精调时需按 v2 身体重对）
  slash1_sheet_v2.png  12帧 4×3，512×512 格（过顶下劈）→ attack_sword.png
  slash2_sheet_v2.png  12帧 4×3，512×512 格（肩高快劈）  → attack_sword_2.png
  thrust_sheet_v2.png  16帧 4×4，512×512 格（弓步前刺）  → attack_sword_3.png
v1 源：同目录 {slash1,slash2,thrust}_sheet.png（已退役，定稿留档见 backup assets-player-v1/）
处理：
  1) 留档：v1 定稿（当前 assets/player/attack_sword{,_2,_3}.png）
     → backup/2026-08-13-player-anim-opt/assets-player-v1/（手绘原版在 assets-player/，不碰）
  2) 色偏中性化：近中性像素（max-min 通道差 < NEUTRAL_TOL）RGB → 亮度均值（(R+G+B)/3 四舍五入），
     消除绿幕管线统一暖色偏（实测骨白 R-B≈+6~+10）；黑描边通道差小且绝对值低，
     亮度映射前后变化 ≤2 级，视觉不动；alpha 通道不碰
  3) 不做几何重采样：格 512×512 原样输出。决策依据（代码事实）：
     - GameScene._createPlayerSprite 恒 setDisplaySize(144,144)、origin(0.5,0.5) —— 任何格规格
       都被归一到 144×144，屏显身高只取决于 内容高/格高 比；
     - 手绘基准比 = 477/516 = 0.924；新素材站立 432/512 = 0.844（小 ~8.4%）；
     - 追平 0.924 在几何上不可行：slash1 过顶帧内容高 490px，不裁切时比率上限 = 432/490 = 0.882
       （格高必须 ≥ 内容最高的 490），仍差 4.3%，且需重采样全部像素、破坏脚底基线；
     - 脚底基线屏显偏移：手绘 490/516 → 64.7px；新 492/512 → 66.4px，差 1.7px 无感；
     - 512×512 格有先例（dash_recover 同规格在跑）；
     - 攻击是 0.6s 动态爆发段，8.4% 站立身高差接受（已知偏差，必要时 DevTool 后期处理）。
验证：输出每张的中性化统计 + 逐帧内容 bbox（防裁切回归；v2 帧格内不居中是 keep-dx 特性，非 bug）
"""
import os
import shutil
import numpy as np
from PIL import Image

SRC_DIR = r'Y:/工作/无尽轮回/scratch/player_melee3'
DST_DIR = 'assets/player'
BACKUP_DIR = 'backup/2026-08-13-player-anim-opt/assets-player-v1'  # v1 定稿留档（v2 换入前）

# (源文件, 目标文件, cols, rows)
SHEETS = [
    ('slash1_sheet_v2.png', 'attack_sword.png', 4, 3),
    ('slash2_sheet_v2.png', 'attack_sword_2.png', 4, 3),
    ('thrust_sheet_v2.png', 'attack_sword_3.png', 4, 4),
]

NEUTRAL_TOL = 64   # 近中性判定：max-min 通道差 < 此值（实测骨白玫瑰偏 spread 峰值 ~48，留裕量；
                   # 三张 sheet 无真实彩色内容——直方图 64+ 仅个位数 px 抗锯齿混色）
ALPHA_MIN = 0      # alpha>0 才处理（透明像素无意义）


def backup_existing():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    for name in ('attack_sword.png', 'attack_sword_2.png', 'attack_sword_3.png'):
        src = os.path.join(DST_DIR, name)
        dst = os.path.join(BACKUP_DIR, name)
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.copy2(src, dst)
            print(f'留档: {src} → {dst}')
        elif os.path.exists(dst):
            print(f'留档已存在，跳过: {dst}')


def neutralize(im):
    """近中性像素 RGB → 亮度均值；返回 (处理后数组, 统计信息)"""
    rgb = im[:, :, :3]
    a = im[:, :, 3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    mask = (a > ALPHA_MIN) & ((mx - mn) < NEUTRAL_TOL)
    sel = rgb[mask]
    stats_before = None
    if len(sel):
        stats_before = (float((sel[:, 0].astype(np.float64) - sel[:, 2]).mean()),
                        float((sel[:, 1].astype(np.float64) - sel[:, 2]).mean()))
    lum = np.round(rgb.mean(axis=2)).astype(np.int32)
    out = im.copy()
    for c in range(3):
        ch = out[:, :, c]
        ch[mask] = lum[mask]
    stats_after = None
    if len(sel):
        sel2 = out[:, :, :3][mask]
        stats_after = (float((sel2[:, 0].astype(np.float64) - sel2[:, 2]).mean()),
                       float((sel2[:, 1].astype(np.float64) - sel2[:, 2]).mean()))
    # 非中性像素比例（残留绿幕/彩色检查）
    colored = int(((a > ALPHA_MIN) & ((mx - mn) >= NEUTRAL_TOL)).sum())
    return out, stats_before, stats_after, int(mask.sum()), colored


def frame_stats(a, cols, rows):
    H, W = a.shape
    cw, ch = W // cols, H // rows
    tops, bots, lefts, rights = [], [], [], []
    for r in range(rows):
        for c in range(cols):
            cell = a[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            ys, xs = np.nonzero(cell > 10)
            if len(ys) == 0:
                continue
            tops.append(int(ys.min())); bots.append(int(ys.max()))
            lefts.append(int(xs.min())); rights.append(int(xs.max()))
    return (min(tops), max(bots), min(lefts), max(rights),
            max(bots) - min(tops) + 1, max(rights) - min(lefts) + 1)


def main():
    backup_existing()
    for src_name, dst_name, cols, rows in SHEETS:
        src = os.path.join(SRC_DIR, src_name)
        im = np.array(Image.open(src).convert('RGBA')).astype(np.int32)
        out, before, after, n_neutral, n_colored = neutralize(im)
        a = out[:, :, 3]
        top, bot, left, right, ch, cw = frame_stats(a, cols, rows)
        H, W = out.shape[:2]
        dst = os.path.join(DST_DIR, dst_name)
        Image.fromarray(out.astype(np.uint8)).save(dst)
        print(f'{src_name} → {dst}')
        print(f'  sheet {W}×{H}，格 {W // cols}×{H // rows}，帧数 {cols * rows}')
        print(f'  中性化: {n_neutral} px（占比 {n_neutral / max(1, int((a > 0).sum())):.1%} of opaque），'
              f'R-B {before[0]:+.1f}→{after[0]:+.1f}，G-B {before[1]:+.1f}→{after[1]:+.1f}')
        print(f'  非中性残留 px: {n_colored}（绿幕/彩色 spill 检查，应≈0 或仅描边混色带）')
        print(f'  内容 bbox: top {top} bottom {bot} left {left} right {right}，高 {ch} 宽 {cw}'
              f'（格 {H // rows} 高内 top≥0 且 bottom<{H // rows} → 无裁切: {top >= 0 and bot < H // rows}）')
    print('完成。')


if __name__ == '__main__':
    main()
