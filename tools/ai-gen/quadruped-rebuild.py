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
import importlib.util
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


def masks_of(frames, bg=(255.0, 255.0, 255.0), bg_dist=20.0):
    """背景掩码：与背景色距离 > bg_dist 判为主体（彩色背景通用，2026-08-08）。"""
    bg = np.array(bg, dtype=np.float64)
    out = []
    for f in frames:
        rgb = f[..., ::-1].astype(np.float64)  # BGR -> RGB
        out.append(np.linalg.norm(rgb - bg, axis=2) > bg_dist)
    return out


def parse_hex_color(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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


def scan_gait(frames, masks, steady=(12, 105), prange=(16, 120), min_iou=0.60, window=None, top_n=6):
    """步态周期扫描：leg_iou(s, s+P)，返回 top_n 候选 [(iou, s, P)]。
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
    out = []
    seen_p = set()
    for vv, ss, pp in best:
        if pp in seen_p:
            continue
        seen_p.add(pp)
        out.append((vv, ss, pp))
        if len(out) >= top_n:
            break
    return out


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


def load_rebuild_module():
    spec = importlib.util.spec_from_file_location("rebuild_h3_birefnet", REBUILD)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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
    ap.add_argument("--bg-color", default="#FFFFFF",
                    help="视频背景色 #RRGGBB（生成时若用了主体无色底，这里必须传同色，默认白）")
    ap.add_argument("--bg-dist", type=float, default=20.0, help="与背景色的距离阈值")
    args = ap.parse_args()

    frames = load_frames(args.video)
    if len(frames) < 30:
        raise SystemExit(f"video too short: {len(frames)} frames")
    masks = masks_of(frames, bg=parse_hex_color(args.bg_color), bg_dist=args.bg_dist)
    print(f"[quadruped] {os.path.basename(args.video)}: {len(frames)} frames", flush=True)

    if args.seed_frames:
        idxs = [int(x) for x in args.seed_frames.split(",")]
    elif args.kind == "run":
        w0, w1, _ = detect_window(frames, masks, args.min_diff)
        cands = scan_gait(frames, masks, min_iou=args.min_iou, window=(w0, w1))
        if not cands:
            raise SystemExit("no gait period found - lower --min-iou or regenerate the loop video")
        # 用"采样序列相邻帧腿部 IoU 均值"选最优候选（直接以最终平滑度为准）
        best_cand, best_score, best_idxs = None, -1.0, None
        for v, s, P in cands:
            n = P * args.cycles
            if s + n > len(frames):
                n = len(frames) - s
            idx_t = list(range(s, s + n))
            if len(idx_t) < 6:
                continue
            adj = [leg_iou(masks[idx_t[i]], masks[idx_t[i + 1]]) for i in range(len(idx_t) - 1)]
            score = sum(adj) / len(adj)
            if score > best_score:
                best_score, best_cand, best_idxs = score, (v, s, P), idx_t
        if not best_cand:
            raise SystemExit("no usable gait candidate")
        v, s, P = best_cand
        idxs = best_idxs
        print(f"[quadruped] gait: P={P} s={s} leg_iou={v:.2f} 采样平滑度={best_score:.2f} -> {len(idxs)} 连续帧", flush=True)
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
           "--edge-dark", "18", "--zero-transparent-rgb",
           "--bg-color", args.bg_color, "--bg-dist", str(args.bg_dist)]
    subprocess.run(cmd, check=True, stderr=subprocess.STDOUT)

    r = verify_sheet(args.out, args.cell)
    # 自动二次清理保险：首次 post_clean 偶发零星 edge_bright，重跑一次必清
    if not r["clean"]:
        print("[quadruped] auto re-clean...", flush=True)
        rmod = load_rebuild_module()
        im = np.array(Image.open(args.out).convert("RGBA"))
        cleaned = rmod.post_clean_sheet(
            im, args.cell,
            bg=np.array(parse_hex_color(args.bg_color), dtype=np.float64),
            bg_dist=args.bg_dist)
        Image.fromarray(cleaned, "RGBA").save(args.out)
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
