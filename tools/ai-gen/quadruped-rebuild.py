#!/usr/bin/env python3
"""四足怪物动画精灵图一键重建（2026-08-08，黑狼/熊/树精通用）。

一条命令完成：步态周期扫描（run）/ 动作窗口检测（attack）→ 采样抽帧 →
rebuild-h3-birefnet.py（BiRefNet 抠图 + 内置 auto-clean）→ 验证
（CLEAN 五指标 + 相邻帧腿部 IoU + 首尾衔接 + 尺寸）→ 报告。

用法（ComfyUI venv python）：
  python quadruped-rebuild.py --video run.mp4 --kind run --out bear_run.png [--cols 4]
  python quadruped-rebuild.py --video attack.mp4 --kind attack --out bear_attack.png [--cell 640 --center-x 320 --feet-y 513]

run 默认取连续 P×2 帧（两个步态周期，首尾同相无缝）；attack 默认窗口均分 20 帧。
"""

import argparse
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REBUILD = os.path.join(TOOLS_DIR, "rebuild-h3-birefnet.py")


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


def masks_of(frames, threshold=248):
    out = []
    for f in frames:
        r = f[..., 2].astype(int)
        g = f[..., 1].astype(int)
        b = f[..., 0].astype(int)
        out.append(~((r > threshold) & (g > threshold) & (b > threshold)))
    return out


def leg_iou(m1, m2, frac=0.35):
    ys, xs = np.where(m1)
    if not len(ys):
        return 0.0
    y0, y1 = ys.min(), ys.max()
    cut = max(0, y1 - int((y1 - y0) * frac))
    l1 = m1[cut:y1 + 1]
    l2 = m2[cut:y1 + 1]
    inter = np.logical_and(l1, l2).sum()
    union = np.logical_or(l1, l2).sum()
    return inter / max(1, union)


def body_iou(m1, m2):
    return np.logical_and(m1, m2).sum() / max(1, np.logical_or(m1, m2).sum())


def scan_gait(frames, masks, steady=(12, 105), prange=(16, 120), min_iou=0.60, window=None):
    """步态周期扫描：leg_iou(s, s+P)。
    限定在动作窗口（window=(w0,w1)）的匀速中段内找，且保证 s+2P ≤ w1
    （两个周期完整落在窗口内）——排除尾部 idle 重影高 IoU 候选。
    """
    best = []
    s0, s1 = steady
    max_end = None
    if window:
        w0, w1 = window
        s0 = max(s0, w0)
        max_end = w1
    for s in range(s0, s1, 2):
        for P in range(prange[0], prange[1] + 1, 2):
            e = s + P
            if e >= len(frames) - 1:
                continue
            if max_end and e + P > max_end:
                continue
            v = leg_iou(masks[s], masks[e])
            if v > min_iou:
                best.append((v, s, P))
    if not best:
        return None
    best.sort(reverse=True)
    v, s, P = best[0]
    # P 可能被 2 倍周期污染，取更小的同相位 P
    for vv, ss, pp in best:
        if abs(pp - P) < 6:
            continue
        if pp < P and vv >= v - 0.03:
            v, s, P = vv, ss, pp
    return s, P, v


def detect_window(frames, masks, min_diff=0.10):
    ref = masks[0]
    diffs = [1.0 - body_iou(ref, m) for m in masks]
    peak = int(np.argmax(diffs))
    window = [i for i in range(len(frames)) if diffs[i] > min_diff * diffs[peak]]
    if not window:
        window = list(range(len(frames)))
    return window[0], window[-1], diffs[peak]


def sample_even(lo, hi, n):
    return [lo + round((hi - lo) * i / (n - 1)) for i in range(n)]


def verify_sheet(path, cell):
    im = np.array(Image.open(path).convert("RGBA"))
    h, w = im.shape[:2]
    rgb = im[..., :3].astype(np.float64)
    alpha = im[..., 3].astype(np.float64)
    rows, cols = h // cell, w // cell
    stray = 0
    for r in range(rows):
        for c in range(cols):
            sub = alpha[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
            n_lab, lab = cv2.connectedComponents((sub > 30).astype(np.uint8))
            if n_lab > 2:
                stray += n_lab - 2
    semi = int(((alpha > 8) & (alpha < 245)).sum())
    trans_nonblack = int(((alpha < 8) & (rgb.mean(axis=2) > 8)).sum())
    opaque = alpha >= 250
    bright = opaque & (rgb.mean(axis=2) > 150)
    near = cv2.dilate((alpha < 200).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2) > 0
    edge_bright = int((near & bright).sum())
    a = alpha / 255.0
    comp = rgb * a[..., None] + 180 * (1 - a[..., None])
    lum = comp.mean(axis=2)
    residue = int((((a > 0.05) & (a < 0.98)) & (lum > 175)).sum())
    ok = all(v == 0 for v in (stray, semi, trans_nonblack, edge_bright, residue))
    return dict(stray=stray, semi=semi, trans_nonblack=trans_nonblack,
                edge_bright=edge_bright, composite_residue=residue,
                clean=ok, cov=100 * (alpha > 0).mean(), rows=rows, cols=cols, cell=cell)


def cell_alpha(path, idx, cols, rows, cell):
    im = np.array(Image.open(path).convert("RGBA"))[..., 3]
    h, w = im.shape
    ch, cw = h // rows, w // cols
    r, c = idx // cols, idx % cols
    return im[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--kind", choices=["run", "attack"], default="run")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--center-x", type=int, default=256)
    ap.add_argument("--feet-y", type=int, default=410)
    ap.add_argument("--target-h", type=int, default=262)
    ap.add_argument("--frames-count", type=int, default=20, help="attack 均分帧数")
    ap.add_argument("--cycles", type=int, default=2, help="run 采样的步态周期数")
    ap.add_argument("--min-iou", type=float, default=0.60, help="周期扫描腿部 IoU 下限")
    ap.add_argument("--min-diff", type=float, default=0.10, help="attack 窗口检测阈值")
    ap.add_argument("--seed-frames", default=None, help="显式帧列表（逗号分隔，跳过自动检测）")
    args = ap.parse_args()

    frames = load_frames(args.video)
    if len(frames) < 30:
        raise SystemExit(f"video too short: {len(frames)} frames")
    masks = masks_of(frames)
    print(f"[quadruped] {os.path.basename(args.video)}: {len(frames)} frames", flush=True)

    if args.seed_frames:
        idxs = [int(x) for x in args.seed_frames.split(",")]
    elif args.kind == "run":
        w0, w1, _ = detect_window(frames, masks, args.min_diff)
        g = scan_gait(frames, masks, min_iou=args.min_iou, window=(w0, w1))
        if not g:
            raise SystemExit("no gait period found - lower --min-iou or regenerate the loop video")
        s, P, iou = g
        n = P * args.cycles
        if s + n > len(frames):
            n = len(frames) - s
        idxs = list(range(s, s + n))
        print(f"[quadruped] gait: P={P} s={s} leg_iou={iou:.2f} -> {n} 连续帧", flush=True)
    else:
        w0, w1, peak = detect_window(frames, masks, args.min_diff)
        idxs = sample_even(w0, w1, args.frames_count)
        print(f"[quadruped] attack window {w0}..{w1} (peak_diff={peak:.2f}) -> {len(idxs)} 帧", flush=True)

    cmd = [sys.executable, REBUILD, "--video", args.video, "--out", args.out,
           "--frames", ",".join(str(i) for i in idxs),
           "--cols", str(args.cols), "--cell", str(args.cell),
           "--center-x", str(args.center_x), "--feet-y", str(args.feet_y),
           "--target-h", str(args.target_h), "--uniform-h",
           "--lum-clear", "200", "--hard-edge", "245",
           "--edge-dark", "18", "--zero-transparent-rgb"]
    subprocess.run(cmd, check=True, stderr=subprocess.STDOUT)

    r = verify_sheet(args.out, args.cell)
    n = r["rows"] * r["cols"]
    adj = []
    for i in range(n - 1):
        a = cell_alpha(args.out, i, r["cols"], r["rows"], args.cell)
        b = cell_alpha(args.out, i + 1, r["cols"], r["rows"], args.cell)
        adj.append(leg_iou(a, b))
    seam = body_iou(cell_alpha(args.out, 0, r["cols"], r["rows"], args.cell),
                    cell_alpha(args.out, n - 1, r["cols"], r["rows"], args.cell))
    print(f"[quadruped] {os.path.basename(args.out)}: cov={r['cov']:.1f}% "
          f"stray={r['stray']} semi={r['semi']} trans={r['trans_nonblack']} "
          f"edge_bright={r['edge_bright']} residue={r['composite_residue']} "
          f"-> {'CLEAN' if r['clean'] else 'DIRTY'}", flush=True)
    if adj:
        print(f"[quadruped] 相邻帧腿部IoU min/avg/max={min(adj):.2f}/{sum(adj)/len(adj):.2f}/{max(adj):.2f} "
              f"首尾IoU={seam:.2f}", flush=True)


if __name__ == "__main__":
    main()
