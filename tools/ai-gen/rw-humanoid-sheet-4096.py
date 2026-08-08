#!/usr/bin/env python3
"""红狼人 4096² 画布 30 帧切帧（2026-08-08，方案 B）。

规格：4096×4096 画布，8 列 × 4 行 = 32 格，取 30 帧（末行留 2 空）；
每帧 512×1024 竖条（角色直立），按步态周期均匀采样，fixed-scale 保体型一致。
输出 alpha 用阈值 248 抠白底（后续 BEN2 重抠 + band/浅灰清理）。

用法（ComfyUI venv python）：
  python rw-humanoid-sheet-4096.py --video <run.mp4> --out <sheet.png> --n 30
"""
import argparse
import os

import cv2
import numpy as np


def load_frames(video_path):
    cap = cv2.VideoCapture(video_path)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    return frames


def bg_masks(frames, threshold=248):
    masks = []
    for f in frames:
        white = (f[..., 0] > threshold) & (f[..., 1] > threshold) & (f[..., 2] > threshold)
        masks.append(~white)
    return masks


def leg_iou(m1, m2, frac=0.35):
    ys, xs = np.where(m1)
    y0, y1 = ys.min(), ys.max()
    cut = max(0, y1 - int((y1 - y0) * frac))
    l1 = m1[cut : y1 + 1]
    l2 = m2[cut : y1 + 1]
    inter = np.logical_and(l1, l2).sum()
    union = np.logical_or(l1, l2).sum()
    return inter / max(1, union)


def find_cycle(frames, masks, steady=(8, 116), period_range=(40, 124), min_iou=0.75):
    best = []
    s0, s1 = steady
    for s in range(s0, s1, 2):
        for P in range(period_range[0], period_range[1] + 1, 2):
            e = s + P
            if e >= len(frames) - 1:
                continue
            v = leg_iou(masks[s], masks[e])
            if v > min_iou:
                best.append((v, s, e))
    if not best:
        raise RuntimeError("no same-phase gait pair found")
    best.sort(reverse=True)
    return best[0][1], best[0][2]


def key_frame(f, threshold=248, feather=0.3):
    white = ((f[..., 0] > threshold) & (f[..., 1] > threshold) & (f[..., 2] > threshold)).astype(np.uint8)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = (1 - white) * 255
    if feather > 0:
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (3, 3), feather)
    return np.clip(alpha, 0, 255).astype(np.uint8)


def build_sheet(frames, cells, cell_w, cell_h, target_h, feet_y, center_x, cols):
    """每帧裁切角色 -> fixed-scale 缩放到 target_h -> 512×1024 竖条 -> 组装 8×4 sheet。"""
    # 首帧参考比例（高度 target_h，宽度不超 480 留边距）
    alpha0 = key_frame(frames[cells[0]])
    ys0, xs0 = np.where(alpha0 > 30)
    ref_h = ys0.max() - ys0.min() + 1
    ref_w = xs0.max() - xs0.min() + 1
    ref_scale = min(target_h / max(1, ref_h), 480 / max(1, ref_w))
    print(f"  [ref] ref_h={ref_h} ref_w={ref_w} scale={ref_scale:.3f}", flush=True)

    # 全局宽度约束：以所有选中帧的最大 bbox 宽计算参考比例，保证不超 cell_w
    max_ref_w = 0
    for k in cells:
        alpha0 = key_frame(frames[k])
        ys0, xs0 = np.where(alpha0 > 30)
        if len(xs0):
            max_ref_w = max(max_ref_w, xs0.max() - xs0.min() + 1)
    ref_scale = min(target_h / max(1, ref_h), (cell_w - 24) / max(1, max_ref_w))
    print(f"  [ref] ref_h={ref_h} max_ref_w={max_ref_w} scale={ref_scale:.3f}", flush=True)

    out_cells = []
    for k in cells:
        alpha = key_frame(frames[k])
        f = frames[k]
        ys, xs = np.where(alpha > 30)
        if len(xs) == 0:
            raise RuntimeError(f"empty cell from frame {k}")
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        crop = f[y0 : y1 + 1, x0 : x1 + 1]
        a = alpha[y0 : y1 + 1, x0 : x1 + 1]
        ch = y1 - y0 + 1
        scale = ref_scale
        nh = max(1, round(ch * scale))
        nw = max(1, round((x1 - x0 + 1) * scale))
        crop = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
        a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
        cell = np.zeros((cell_h, cell_w, 4), np.uint8)
        ox = center_x - nw // 2
        oy = feet_y - nh + 1
        if ox < 0:
            ox = 0
        if oy < 0:
            oy = 0
        if oy >= 0 and oy + nh <= cell_h:
            px = ox + nw
            py = oy + nh
            if px > cell_w:
                px = cell_w
            if py > cell_h:
                py = cell_h
            cell[oy:py, ox:px] = np.dstack([crop, a])[: py - oy, : px - ox]
        else:
            print(f"  [warn] frame {k}: too large {nw}x{nh} at {ox},{oy} - clamp", flush=True)
            cell[0:cell_h, 0:cell_w] = 0
        out_cells.append(cell)

    # 组装 8 列 × 4 行 = 32 格，取 n 帧，末行补齐透明格
    n = len(out_cells)
    rows = []
    blank = np.zeros((cell_h, cell_w, 4), np.uint8)
    for r in range(4):
        row = out_cells[r * cols : (r + 1) * cols]
        while len(row) < cols:
            row.append(blank)
        rows.append(np.hstack(row))
    sheet = np.vstack(rows)
    return sheet, out_cells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=30, help="帧数 (<=32)")
    ap.add_argument("--target-h", type=int, default=900, help="角色高度（512×1024 竖条内）")
    ap.add_argument("--feet-y", type=int, default=1000, help="脚底基线 y")
    ap.add_argument("--center-x", type=int, default=256, help="水平中心（512 宽内）")
    ap.add_argument("--steady", default="8,116")
    ap.add_argument("--period", default="40,124")
    ap.add_argument("--min-iou", type=float, default=0.75)
    ap.add_argument("--cols", type=int, default=8)
    args = ap.parse_args()

    frames = load_frames(args.video)
    masks = bg_masks(frames)
    s0, s1 = (int(x) for x in args.steady.split(","))
    p0, p1 = (int(x) for x in args.period.split(","))
    s, e = find_cycle(frames, masks, steady=(s0, s1), period_range=(p0, p1), min_iou=args.min_iou)
    cells = [s + round((e - s) * i / (args.n - 1)) for i in range(args.n)]
    cells = sorted(set(max(0, min(len(frames) - 1, i)) for i in cells))
    while len(cells) < args.n:
        cells.append(cells[-1] + 1)
    print(f"[sheet4096] cycle s={s} e={e} (period {e-s}), {len(cells)} frames", flush=True)

    sheet, _ = build_sheet(frames, cells, 512, 1024, args.target_h, args.feet_y,
                           args.center_x, args.cols)
    cv2.imwrite(args.out, sheet)
    print(f"[sheet4096] sheet {sheet.shape} -> {args.out}", flush=True)

    # 对齐统计
    feets, cents, hs = [], [], []
    for c in cells:
        alpha = key_frame(frames[c])
        ys, xs = np.where(alpha > 30)
        if len(ys) == 0:
            continue
        feets.append(ys.max())
        cents.append((xs.min() + xs.max()) / 2)
        hs.append(ys.max() - ys.min() + 1)
    print(f"[sheet4096] alignment: feet=[{min(feets)},{max(feets)}] "
          f"center_x=[{min(cents):.0f},{max(cents):.0f}] height=[{min(hs)},{max(hs)}]", flush=True)


if __name__ == "__main__":
    main()
