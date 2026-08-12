#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""player-aimsweep-extract.py — 主角瞄准扫描视频 → 角度×相位帧表 sheet（2026-08-12）。

输入：aim_down/v2/up 三条绿幕视频（同一首帧锚定）。
逐帧处理：
  1) 绿幕抠图（chroma 距离，纯绿底硬切）+ 最大连通域
  2) 红底/异常帧剔除（角点背景色偏离绿即弃帧——H3 偶发整帧变色）
  3) 手臂角度估计：肩锚点 = 掩膜质心上方 35% 处；手尖 = 肩线上方最远掩膜点
  4) 后座相位检测：手尖附近"体外"高亮像素（火光晕染在绿底上），阈值按视频分布自适应
  5) 按角度分桶（默认 7.5°/桶），每桶选 neutral（无火光、角度最接近桶中心）
     + flinch（有火光、角度最近）各一
后处理（SKILL 黑狼惯例角色版）：
  - despill：绿溢色压制（G 压到 max(R,B) 的 1.15 倍以内）
  - defringe：边缘 1px 像素染最近内侧实体色
  - 透明区 RGB 外渗（防线性过滤黑边）
输出：紧凑 sheet（仅有效桶，每桶一行：左 neutral 右 flinch），512×516 格、
内容高 477、脚底 y=492（玩家精灵基准，WORKFLOW §2）+ aim_table.json
（每桶角度/有无 flinch/手尖 cell 坐标=武器锚点）。

用法（venv-sprites python）：
  python tools/ai-gen/player-aimsweep-extract.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

SCRATCH = r"Y:\工作\无尽轮回\scratch\player_char"
VIDEOS = ["aim_down_v1.mp4", "aim_sweep_v2.mp4", "aim_up_v1.mp4"]
OUT_DIR = os.path.join(SCRATCH, "extract_v1")
GREEN = np.array([0, 255, 0], dtype=np.float64)

CELL_W, CELL_H = 512, 516
FEET_Y = 492
TARGET_H = 477
CENTER_X = 256
BIN_DEG = 7.5
ANGLE_MIN, ANGLE_MAX = -67.5, 97.5


def load_frames(path):
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    cap.release()
    return frames


def analyze(rgb):
    """返回 (mask, angle, flash_count, tip, ok)。ok=False = 红底/异常帧。"""
    f64 = rgb.astype(np.float64)
    dist = np.linalg.norm(f64 - GREEN, axis=2)
    corners = np.concatenate([rgb[:20, :20].reshape(-1, 3), rgb[:20, -20:].reshape(-1, 3),
                              rgb[-20:, :20].reshape(-1, 3), rgb[-20:, -20:].reshape(-1, 3)])
    if np.linalg.norm(corners.astype(np.float64) - GREEN, axis=1).mean() > 90:
        return None, None, 0, None, False
    mask = dist > 80
    lab, n = ndimage.label(mask)
    if n < 1:
        return None, None, 0, None, False
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    main = lab == (np.argmax(sizes) + 1)
    ys, xs = np.where(main)
    cx, cy = xs.mean(), ys.min() + (ys.max() - ys.min()) * 0.35
    up = ys < cy + 30
    if not up.any():
        return main, None, 0, None, True
    idx = np.argmax(xs[up])
    hx, hy = int(xs[up][idx]), int(ys[up][idx])
    angle = float(-np.degrees(np.arctan2(hy - cy, hx - cx)))
    # 火光：手尖附近"身体掩膜之外"的高亮像素（体内皮肤/衣料高光不算）
    rx0, rx1 = max(0, hx - 100), min(rgb.shape[1], hx + 100)
    ry0, ry1 = max(0, hy - 100), min(rgb.shape[0], hy + 100)
    region = rgb[ry0:ry1, rx0:rx1].astype(np.int32)
    outside = ~ndimage.binary_dilation(main[ry0:ry1, rx0:rx1], iterations=3)
    flash_count = int(((region.mean(axis=2) > 220) & outside).sum())
    return main, angle, flash_count, (hx, hy), True


def post_process(sheet):
    """despill + defringe + 透明区外渗。"""
    rgb = sheet[..., :3].astype(np.float64)
    alpha = sheet[..., 3]
    opaque = alpha > 127
    # despill：绿溢色压制（仅边缘 2px 带内，身体内部的绿色元素不动）
    edge = opaque & ~ndimage.binary_erosion(opaque, iterations=2)
    g = rgb[..., 1]
    gmax = np.maximum(rgb[..., 0], rgb[..., 2]) * 1.15
    spill = edge & (g > gmax)
    rgb[..., 1][spill] = gmax[spill]
    # defringe：边缘像素染最近内侧实体色
    inner = ndimage.binary_erosion(opaque, iterations=1)
    _, ind = ndimage.distance_transform_edt(~inner, return_indices=True)
    e2 = opaque & ~inner
    rgb[e2] = rgb[ind[0][e2], ind[1][e2]]
    # 透明区外渗（<=24px 用最近实体色，之外置黑无所谓）
    dist = ndimage.distance_transform_edt(~opaque)
    _, ind2 = ndimage.distance_transform_edt(~opaque, return_indices=True)
    bleed = (~opaque) & (dist <= 24)
    rgb[bleed] = rgb[ind2[0][bleed], ind2[1][bleed]]
    rgb[~opaque & (dist > 24)] = 0
    return np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha]).astype(np.uint8)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    pool = []
    for vname in VIDEOS:
        frames = load_frames(os.path.join(SCRATCH, vname))
        recs = []
        for i, rgb in enumerate(frames):
            mask, angle, fc, tip, ok = analyze(rgb)
            if not ok or angle is None:
                continue
            recs.append(dict(angle=angle, fc=fc, rgb=rgb, mask=mask, tip=tip, src=f"{vname}#{i}"))
        counts = np.array([r["fc"] for r in recs])
        thr = max(30.0, float(np.median(counts)) * 3.0)
        for r in recs:
            r["flash"] = r["fc"] > thr
            pool.append(r)
        print(f"[extract] {vname}: {len(recs)}/{len(frames)} 帧可用, "
              f"火光阈值 {thr:.0f}, 后座帧 {sum(r['flash'] for r in recs)}", flush=True)

    bins = np.arange(ANGLE_MIN, ANGLE_MAX, BIN_DEG)
    table = []
    for b in bins:
        in_bin = [p for p in pool if abs(p["angle"] - b) < BIN_DEG / 2]
        neutral = [p for p in in_bin if not p["flash"]]
        flinch = [p for p in in_bin if p["flash"]]
        n_pick = min(neutral, key=lambda p: abs(p["angle"] - b)) if neutral else None
        f_pick = min(flinch, key=lambda p: abs(p["angle"] - b)) if flinch else None
        if n_pick is not None:
            table.append(dict(angle=float(b), n=n_pick, f=f_pick))

    print(f"[extract] 有效角度桶: {len(table)} "
          f"({table[0]['angle']}° ~ {table[-1]['angle']}°)", flush=True)

    # 固定缩放（2026-08-12 修"举枪人物缩小"bug）：所有帧共用同一 scale——
    # 以近水平帧身高为基准，上举帧只是 bbox 变高（顶部多占空间），人物大小恒定。
    # scale 上限：最高帧恰好放得下（脚底 492 + 顶部留 8px 边距）
    def _ch(pick):
        ys, _xs = np.where(pick["mask"])
        return ys.max() - ys.min() + 1
    picks_all = [p for t in table for p in (t["n"], t["f"]) if p is not None]
    ch_ref = _ch(min(table, key=lambda t: abs(t["angle"]))["n"])
    max_ch = max(_ch(p) for p in picks_all)
    scale = min(TARGET_H / ch_ref, (FEET_Y - 8) / max_ch)
    print(f"[extract] 固定缩放 scale={scale:.4f}（基准身高 {ch_ref}→{round(ch_ref*scale)}px, "
          f"最高帧 {max_ch}→{round(max_ch*scale)}px）", flush=True)

    # 紧凑 sheet：每个有效桶一行（左 neutral 右 flinch）
    rows = []
    for t in table:
        row_cells = []
        for pick in (t["n"], t["f"]):
            cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
            if pick is not None:
                rgb, mask = pick["rgb"], pick["mask"]
                ys, xs = np.where(mask)
                x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
                ch, cw = y1 - y0 + 1, x1 - x0 + 1
                nh = round(ch * scale)
                nw = max(1, round(cw * scale))
                rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
                crop = np.array(Image.fromarray(rgba[y0:y1 + 1, x0:x1 + 1], "RGBA")
                                .resize((nw, nh), Image.LANCZOS))
                ox = max(0, min(CENTER_X - nw // 2, CELL_W - nw))
                oy = FEET_Y - nh + 1
                cell[oy:oy + nh, ox:ox + nw] = crop
                # 手尖 → cell 坐标（武器锚点）
                tx, ty = pick["tip"]
                pick["cell_tip"] = [int((tx - x0) * scale) + ox, int((ty - y0) * scale) + oy]
            row_cells.append(cell)
        rows.append(np.hstack(row_cells))
    sheet = np.vstack(rows)
    sheet = post_process(sheet)
    out_png = os.path.join(OUT_DIR, "aim_sheet.png")
    Image.fromarray(sheet, "RGBA").save(out_png)

    out_table = [dict(angle=t["angle"], hasFlinch=t["f"] is not None,
                      tip=t["n"].get("cell_tip"), src=t["n"]["src"]) for t in table]
    with open(os.path.join(OUT_DIR, "aim_table.json"), "w", encoding="utf-8") as fh:
        json.dump(out_table, fh, ensure_ascii=False, indent=1)
    print(f"[extract] sheet {sheet.shape} -> {out_png}", flush=True)


if __name__ == "__main__":
    main()
