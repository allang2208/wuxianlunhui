#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""player-locomotion-matrix.py — 主角移动瞄准矩阵（2026-08-12，路线 B）。

对瞄准帧组（aim_sheet.png，12 角度桶 × neutral）逐桶生成：
  walk / run 两条"固定角度持枪原地走/跑"视频（首帧=该桶 neutral 帧合成绿幕，
  角度被首帧锁死，模型只出步态）→ 步态周期检测抽 8 帧 → 拼 sheet。

输出：
  walk_sheet.png / run_sheet.png（每桶一行 × 8 步态帧，512×516 格，
  与 aim_sheet 同尺度：固定 scale、脚底 y=492）+ matrix_table.json

用法（venv-sprites python）：
  python tools/ai-gen/player-locomotion-matrix.py --phase firstframes   # 生成 24 张首帧
  python tools/ai-gen/player-locomotion-matrix.py --phase gen           # 批量生成视频（幂等，已存在跳过）
  python tools/ai-gen/player-locomotion-matrix.py --phase extract       # 抽帧拼 sheet
  python tools/ai-gen/player-locomotion-matrix.py --phase all           # 依次全跑
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev"
SCRATCH = r"Y:\工作\无尽轮回\scratch\player_char"
AIM_SHEET = os.path.join(SCRATCH, "extract_v1", "aim_sheet.png")
FF_DIR = os.path.join(SCRATCH, "matrix_firstframes")
VID_DIR = os.path.join(SCRATCH, "matrix_videos")
OUT_DIR = os.path.join(SCRATCH, "matrix_out")
GEN = os.path.join(ROOT, "tools", "ai-gen", "minimax-h3-gen.py")
HOST = "192.168.3.142"

CELL_W, CELL_H = 512, 516
FEET_Y = 492
CENTER_X = 256
N_BINS = 12          # 与 aim_sheet 桶数一致
GAIT_FRAMES = 32     # 每桶步态帧数（2026-08-12 用户要求 32 帧尽可能流畅）
GAIT_COLS = 16       # sheet 每行 16 格（每桶占 2 行；32×512 超 8192 纹理上限拆行）
# 与 aim_sheet 完全同尺度：抽帧脚本算出的固定缩放（基准身高 552→425px）
FIXED_SCALE = 0.7707
# 首帧合成：与 firstframe_aim.png 同构图（内容高 553、脚底的 696、水平 42% 处）
FF_CHAR_H = 553
FF_FEET_Y = 696
FF_W, FF_H = 1344, 768

WALK_PROMPT = ("The hooded female fighter from the first frame walks in place at a steady pace, "
               "strict side-profile view facing right, holding an invisible rifle in her two-handed "
               "grip exactly at the same aim angle as the first frame — her arms stay locked and do "
               "not raise or lower at all, only her legs cycle through a walking gait. Body stays "
               "centered, consistent size, no weapon appears. Static locked-off camera, no zoom, no "
               "pan, no cuts. Quiet room tone, no music.")
RUN_PROMPT = WALK_PROMPT.replace("walks in place at a steady pace", "runs in place at a fast steady jog") \
                         .replace("walking gait", "running gait")


def phase_firstframes():
    os.makedirs(FF_DIR, exist_ok=True)
    sheet = Image.open(AIM_SHEET).convert("RGBA")
    a = np.array(sheet)
    for b in range(N_BINS):
        cell = a[b * CELL_H:(b + 1) * CELL_H, 0:CELL_W]  # neutral 列
        alpha = cell[..., 3] > 127
        ys, xs = np.where(alpha)
        if not len(ys):
            print(f"[ff] bin {b} 空桶跳过", flush=True)
            continue
        content = Image.fromarray(cell, "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        cw, ch = content.size
        scale = FF_CHAR_H / ch
        nw, nh = round(cw * scale), round(ch * scale)
        char = content.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGBA", (FF_W, FF_H), (0, 255, 0, 255))
        canvas.alpha_composite(char, (int((FF_W - nw) * 0.42), FF_FEET_Y - nh))
        canvas.convert("RGB").save(os.path.join(FF_DIR, f"bin_{b:02d}.png"))
    print(f"[ff] {N_BINS} 张首帧 -> {FF_DIR}", flush=True)


def phase_gen():
    os.makedirs(VID_DIR, exist_ok=True)
    for state, prompt in (("walk", WALK_PROMPT), ("run", RUN_PROMPT)):
        pf = os.path.join(SCRATCH, f"matrix_{state}_prompt.txt")
        with open(pf, "w", encoding="utf-8") as fh:
            fh.write(prompt)
        for b in range(N_BINS):
            ff = os.path.join(FF_DIR, f"bin_{b:02d}.png")
            out = os.path.join(VID_DIR, f"{state}_bin_{b:02d}.mp4")
            if not os.path.exists(ff):
                continue
            if os.path.exists(out) and os.path.getsize(out) > 100_000:
                print(f"[gen] 跳过已有 {state}_bin_{b:02d}", flush=True)
                continue
            cmd = [sys.executable, GEN, "--host", HOST,
                   "--first-frame", ff, "--bg-color", "00FF00",
                   "--prompt-file", pf, "--duration", "3", "--size", "1344x768",
                   "--out", out]
            print(f"[gen] {state} bin {b} ...", flush=True)
            subprocess.run(cmd, check=True)


def detect_gait_cycle(masks):
    """全步态周期检测（模板匹配法）：枚举 (起点 s, 周期 P)，找使
    frames[s..s+P) 与 frames[s+P..s+2P) 掩膜差异最小的组合。
    腿区差分自相关会锁到半步长（左右腿对称，"只迈一步"循环断裂根因），
    全帧模板匹配 + P≥16（24fps 下 ≥0.66s，单步不可能这么长）杜绝半步误判。"""
    n = len(masks)
    small = [np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((64, 64), Image.NEAREST)) > 0
             for m in masks]
    best = (0, 24, 1e9)
    for P in range(16, min(48, n // 2)):
        for s in range(0, n - 2 * P, 2):
            d = sum(np.logical_xor(small[s + k], small[s + P + k]).mean() for k in range(0, P, 2))
            if d < best[2]:
                best = (s, P, d)
    return best[0], best[1]


def phase_extract(states=("walk", "run")):
    os.makedirs(OUT_DIR, exist_ok=True)
    GREEN = np.array([0, 255, 0], dtype=np.float64)
    meta = {"bins": N_BINS, "gaitFrames": GAIT_FRAMES, "scale": FIXED_SCALE,
            "cell": [CELL_W, CELL_H], "feetY": FEET_Y, "centerX": CENTER_X}
    for state in states:
        strips = []  # 每桶 2 条行带（16 格/条）
        for b in range(N_BINS):
            vp = os.path.join(VID_DIR, f"{state}_bin_{b:02d}.mp4")
            if not os.path.exists(vp):
                print(f"[extract] {state} bin {b} 缺视频，空带占位", flush=True)
                strips.append(np.zeros((CELL_H, CELL_W * GAIT_COLS, 4), np.uint8))
                strips.append(np.zeros((CELL_H, CELL_W * GAIT_COLS, 4), np.uint8))
                continue
            cap = cv2.VideoCapture(vp)
            raw = []
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                raw.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
            cap.release()
            masks = []
            for rgb in raw:
                dist = np.linalg.norm(rgb.astype(np.float64) - GREEN, axis=2)
                m = dist > 80
                lab, n = ndimage.label(m)
                if n > 1:
                    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
                    m = lab == (np.argmax(sizes) + 1)
                masks.append(m)
            start, period = detect_gait_cycle(masks)
            idxs = [start + round(period * i / GAIT_FRAMES) for i in range(GAIT_FRAMES)]
            idxs = [min(i, len(raw) - 1) for i in idxs]
            cells = []
            for i in idxs:
                rgb, m = raw[i], masks[i]
                ys, xs = np.where(m)
                x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
                ch, cw = y1 - y0 + 1, x1 - x0 + 1
                nh, nw = round(ch * FIXED_SCALE), max(1, round(cw * FIXED_SCALE))
                rgba = np.dstack([rgb, (m * 255).astype(np.uint8)])
                crop = np.array(Image.fromarray(rgba[y0:y1 + 1, x0:x1 + 1], "RGBA")
                                .resize((nw, nh), Image.LANCZOS))
                cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
                ox = max(0, min(CENTER_X - nw // 2, CELL_W - nw))
                oy = FEET_Y - nh + 1
                if oy >= 0 and oy + nh <= CELL_H:
                    cell[oy:oy + nh, ox:ox + nw] = crop
                cells.append(cell)
            # 不足 32 格补空；按 16 格/条拆成两条行带
            while len(cells) < GAIT_FRAMES:
                cells.append(np.zeros((CELL_H, CELL_W, 4), np.uint8))
            strips.append(np.hstack(cells[:GAIT_COLS]))
            strips.append(np.hstack(cells[GAIT_COLS:GAIT_FRAMES]))
            print(f"[extract] {state} bin {b}: 周期 {period} 帧, 起点 {start}", flush=True)
        sheet = np.vstack(strips)
        # 后处理（despill/defringe/外渗）：复用 player-aimsweep-extract 的 post_process
        spec = importlib_import()
        sheet = spec.post_process(sheet)
        out = os.path.join(OUT_DIR, f"{state}_sheet.png")
        Image.fromarray(sheet, "RGBA").save(out)
        print(f"[extract] {state} sheet {sheet.shape} -> {out}", flush=True)
    with open(os.path.join(OUT_DIR, "matrix_table.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)


def importlib_import():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "pe", os.path.join(ROOT, "tools", "ai-gen", "player-aimsweep-extract.py"))
    pe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pe)
    return pe


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["firstframes", "gen", "extract", "all"], required=True)
    ap.add_argument("--state", choices=["walk", "run"], default=None,
                    help="extract 时只处理某个状态（缺省两个都处理，缺视频空行占位）")
    args = ap.parse_args()
    if args.phase in ("firstframes", "all"):
        phase_firstframes()
    if args.phase in ("gen", "all"):
        phase_gen()
    if args.phase in ("extract", "all"):
        phase_extract(states=(args.state,) if args.state else ("walk", "run"))


if __name__ == "__main__":
    main()
