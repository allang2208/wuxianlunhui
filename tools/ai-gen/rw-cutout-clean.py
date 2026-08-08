#!/usr/bin/env python3
"""红狼王精灵图抠图清理（2026-08-07，套黑狼 CLEAN 铁律 + 红毛局部色还原）。

黑狼教训（SKILL 十五~十八版）：AI 贴图边缘是"背景白+主体"混合灰，单纯调 alpha 阈值
永远留白边；必须：alpha 硬二值化 -> 每格最大连通域 -> 边缘亮像素按局部毛色还原 ->
透明区 RGB 归零 -> 腿部区域去残留。

与黑狼的差异：红狼王边缘无白毛，但毛色偏红褐（内邻均值 ~(128,89,94)），
不能用黑狼的固定 18（会压成黑点），改为 5x5 邻域毛色均值还原，兜底深红 (90,18,18)。

用法（ComfyUI venv python）：
  python rw-cutout-clean.py --in <目录> [--cell 512] [--only idle,run]
输出就地覆盖（先用 ASCII 临时目录副本验证，再拷回 assets）。
"""

import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

DARK_RED = (90, 18, 18)  # 红狼王深红毛兜底色（SKILL 十四版 idle RGB 基准）

CELLS = {
    "red_wolf_king_idle.png": 512,
    "red_wolf_king_run.png": 512,
    "red_wolf_king_pacing.png": 512,
    "red_wolf_king_pounce_claw.png": 512,
    "red_wolf_king_pounce_bite.png": 576,
    "red_wolf_king_change.png": 512,
    "red_wolf_king_howl.png": 512,
    "red_wolf_king_transformed_idle.png": 512,
    "red_wolf_king_changed_run.png": 512,
    "red_wolf_king_changed_attack.png": 512,
}


def clean_sheet(path, cell=512, hard=245, lum_edge=90, lum_leg=160, soft=False):
    """soft=True = 红狼王规则：不硬二值化，保留浅毛软边（semi≈0.5%），只清污染。
    黑狼规则（soft=False）：alpha 硬二值化（>=245），semi=0，接受锯齿。"""
    im = np.array(Image.open(path).convert("RGBA"))
    rgb = im[..., :3].astype(np.float64)
    alpha = im[..., 3].astype(np.float64)
    if soft:
        # 红狼王去污染（SKILL sprite-decontaminate）：半透像素反推前景色
        # F=(C-(1-α)·B)/α（B=白底255），混合灰还原真实毛色；反推后仍亮=未分离残留→清零。
        a_n = alpha / 255.0
        semi = (a_n > 0.03) & (a_n < 0.98)
        if semi.any():
            f = np.clip((rgb[semi] - (1.0 - a_n[semi])[:, None] * 255.0) / a_n[semi][:, None], 0, 255)
            still_bright = f.mean(axis=1) > 165
            idx = np.where(semi)
            rgb[idx[0][still_bright], idx[1][still_bright]] = 0
            alpha[idx[0][still_bright], idx[1][still_bright]] = 0
            keep = ~still_bright
            rgb[idx[0][keep], idx[1][keep]] = f[keep]
        # 注：不做 composite 亮半透清零——实测会切断腿部/身体连接处的半透，
        # max-component 随后把整条腿当孤立域删掉（frame 宽 272→193）。
        # 粉色/亮红残留由 3b 欧氏距离染深红解决（只改色不改 alpha，形状完整）。
    h, w = alpha.shape
    rows, cols = h // cell, w // cell
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = alpha[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            if soft:
                # 红狼王：保留软边 alpha（浅毛软边是特征，不是残留）；污染已全局去污
                a_bin = ac.copy().astype(np.uint8)
            else:
                # 黑狼：alpha 硬二值化（清 resize/插值半透带）
                a_bin = np.where(ac >= hard, 255, 0).astype(np.uint8)
            # 2) 每格只保留最大连通域（清孤立噪点色块）
            lab, n = ndimage.label(a_bin > 30)
            if n > 1:
                areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
                areas.sort(reverse=True)
                keep = areas[0][1]
                drop = (lab > 0) & (lab != keep)
                a_bin[drop] = 0
                rc[drop] = 0
            opaque = a_bin >= 250
            bright = opaque & (rc.mean(axis=2) > lum_edge)
            trans = a_bin < 200
            near = ndimage.binary_dilation(trans, iterations=2)
            # 3) 边缘亮像素 -> 5x5 邻域毛色均值（黑狼固定 18 会把红毛压成黑点）
            #    邻域无毛色时用"该格深红毛中位数"兜底，避免固定色形成整圈人工描边
            fur_px = rc[opaque & (rc.mean(axis=2) < 60)]
            cell_fur = np.median(fur_px, axis=0) if len(fur_px) else np.array(DARK_RED, dtype=np.float64)
            dark = opaque & (~bright)
            cnt = ndimage.uniform_filter(dark.astype(np.float32), size=5) * 25.0
            mean = np.stack([
                ndimage.uniform_filter((rc[..., i] * dark).astype(np.float32), size=5) * 25.0
                for i in range(3)
            ], axis=-1) / np.maximum(cnt[..., None], 1e-6)
            mean = np.clip(mean, 0, 255).astype(np.uint8)
            mean[cnt < 1] = cell_fur
            rc[near & bright] = mean[near & bright]
            # 3b) 边缘亮红残留 -> 该格深红毛中位数（边缘像素与深红参考的
            #     欧氏距离 > 35 = 白底×红毛混合残留，如 (85,47,53) vs (39,4,5)，
            #     实测全身轮廓一圈，亮度 27~90 之前阈值漏网）
            edge_dist = np.sqrt(((rc - cell_fur[None, None, :]) ** 2).sum(axis=2))
            edge_red = near & opaque & (edge_dist > 12)
            rc[edge_red] = cell_fur
            # 4) 透明区 RGB 归零
            rc[a_bin < 8] = 0
            # 5) 脚部地面接触阴影清理：内容底部带内低饱和（灰/黑，R≈G≈B）不透明像素
            #    直接抠掉（H3 白底视频自带接触阴影，红毛 sat≥19 保留，阴影 sat<15 剔除）
            body = a_bin >= 200
            ys, xs = np.where(body)
            if len(ys):
                ymin, ymax = ys.min(), ys.max()
                cut = max(0, ymax - min(40, int((ymax - ymin) * 0.25)))
                band = np.zeros_like(body)
                band[cut:ymax + 1, :] = True
                sat_full = rc.max(axis=2) - rc.min(axis=2)
                lum_full = rc.mean(axis=2)
                # 只删"暗灰黑"（地面接触阴影，lum<100）；亮灰白（H3 运动模糊/浅毛，
                # 如 frame1 腿 192,185,185）不是阴影，交给 leg-bright 染成深红毛色
                shadow = band & body & (sat_full < 15) & (lum_full < 100)
                if shadow.any():
                    a_bin[shadow] = 0
                    rc[shadow] = 0
                    # 阴影剔除后可能产生小碎片：只保留最大连通域
                    lab2, n2 = ndimage.label(a_bin > 30)
                    if n2 > 1:
                        areas2 = [(int((lab2 == i).sum()), i) for i in range(1, n2 + 1)]
                        areas2.sort(reverse=True)
                        keep2 = areas2[0][1]
                        drop2 = (lab2 > 0) & (lab2 != keep2)
                        a_bin[drop2] = 0
                        rc[drop2] = 0
                # 5b) 脚底带颜色归一化：脚底带（内容底部 40px）内，偏离该格深红毛的
                #     亮红粉/灰像素（被脚包围、不邻接透明，3b 边缘判定覆盖不到）
                #     统一染成深红毛色——脚下"地板色块"（亮红粉/灰）由此清除
                dist_f = np.sqrt(((rc - cell_fur[None, None, :]) ** 2).sum(axis=2))
                lum_f = rc.mean(axis=2)
                sat_f = rc.max(axis=2) - rc.min(axis=2)
                foot_fix = band & opaque & ((dist_f > 12) | ((lum_f > 100) & (sat_f < 20)))
                rc[foot_fix] = cell_fur
                # 5c) 脚部/腿部中亮灰粉块 -> 深红毛色还原（2026-08-08 红狼人奔跑脚部大片色块根因）：
                #     不透明 + 低饱和(sat<25) + 中亮(lum 40~160) 且偏离深红毛 >40 的像素
                #     是白底×红毛混合残留（实测 (97,80,82) vs 深红 (34,2,3)，lum 86 低于
                #     旧阈值 90、sat 17 高于旧阈值 15，被 3b/5b 漏掉——5b 的 band 只覆盖
                #     底部 40px，灰粉块延伸到脚踝上方 y 300-369 超出 band）。
                #     统一还原深红毛，保留 alpha（它们在脚部核心、非边缘，删 alpha 会缺脚）。
                gray_mid = opaque & (sat_f < 25) & (lum_f > 40) & (lum_f < 160) & (dist_f > 40)
                if gray_mid.any():
                    rc[gray_mid] = cell_fur
                # 6) 腿部区域（bbox 底部 35%）内不透明亮像素 -> 局部毛色（清贴地灰白）
                cut2 = max(0, ymin + int((ymax - ymin) * 0.65))
                band2 = np.zeros_like(body)
                band2[cut2:ymax + 1, :] = True
                bright_leg = band2 & body & (rc.mean(axis=2) > lum_leg)
                if bright_leg.any():
                    dark2 = body & (~bright_leg)
                    cnt2 = ndimage.uniform_filter(dark2.astype(np.float32), size=5) * 25.0
                    mean2 = np.stack([
                        ndimage.uniform_filter((rc[..., i] * dark2).astype(np.float32), size=5) * 25.0
                        for i in range(3)
                    ], axis=-1) / np.maximum(cnt2[..., None], 1e-6)
                    mean2 = np.clip(mean2, 0, 255).astype(np.uint8)
                    mean2[cnt2 < 1] = cell_fur
                    rc[bright_leg] = mean2[bright_leg]
            ac[...] = a_bin
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(path)
    print(f"cleaned {os.path.basename(path)} ({h}x{w}, cell {cell})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--only", default=None, help="comma list of filenames; default all")
    ap.add_argument("--file", default=None, help="single file to clean (any name), cell defaults 512")
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--soft", action="store_true", help="红狼王规则：保留浅毛软边（不硬二值化）")
    args = ap.parse_args()
    if args.file:
        p = os.path.join(args.indir, args.file)
        if os.path.exists(p):
            clean_sheet(p, cell=args.cell, soft=args.soft)
        else:
            print("missing:", p)
        return
    names = [n for n in CELLS if os.path.exists(os.path.join(args.indir, n))]
    if args.only:
        names = [n for n in names if n in args.only.split(",")]
    for name in names:
        clean_sheet(os.path.join(args.indir, name), cell=CELLS[name], soft=args.soft)


if __name__ == "__main__":
    main()
