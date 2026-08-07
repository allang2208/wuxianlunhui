#!/usr/bin/env python3
"""Extract a seamlessly-looping sprite sheet from an H3 first/last-frame loop video.

Problem: H3 loop videos (first_frame == last_frame) are one-shot arcs that ease back
to the start pose; they are NOT periodic, so naively trimming a cycle produces a
jump at the sheet seam (mid-stride -> reference pose).

Algorithm (verified 2026-08-05 on foreman walk):
  1. Key out the solid background (threshold 235) + fill small holes + feather.
  2. Scan the STEADY middle of the clip for a same-phase pair (s, e) using
     leg-region IoU (bottom 35% of the body) - this finds the true gait period P.
  3. Use the cycle [s, e-step): drop the duplicate endpoint (pose(e) == pose(s)),
     so the sheet seam (last cell -> first cell) is a NORMAL step, not a jump/hold.
  4. Verify the seam step magnitude against normal steps (should fall in range).
  5. Align every cell: fixed character height, fixed feet baseline, horizontal center.

Usage (run with the ComfyUI venv python - it has cv2):
    .venv\\Scripts\\python.exe tools/ai-gen/h3-loop-spritesheet.py ^
        --video <loop.mp4> --out <sheet.png> [--out-gif <preview.gif>] [--cols 5]

Chinese output paths: write to %TEMP% then Copy-Item to the final location.
"""

import argparse
import os

import cv2
import numpy as np
from PIL import Image


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
        b = f[..., 0].astype(int)
        g = f[..., 1].astype(int)
        r = f[..., 2].astype(int)
        white = (r > threshold) & (g > threshold) & (b > threshold)
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


def body_diff(f1, f2, frac=1.0):
    def crop(f, fr):
        b = f[..., 0].astype(int)
        g = f[..., 1].astype(int)
        r = f[..., 2].astype(int)
        white = (r > 235) & (g > 235) & (b > 235)
        ys, xs = np.where(~white)
        c = f[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        if fr < 1.0:
            c = c[int(c.shape[0] * (1 - fr)) :, :]
        return cv2.cvtColor(c, cv2.COLOR_BGR2GRAY).astype(float)

    g1, g2 = crop(f1, frac), crop(f2, frac)
    h = min(g1.shape[0], g2.shape[0])
    w = min(g1.shape[1], g2.shape[1])
    return np.abs(cv2.resize(g1, (w, h)) - cv2.resize(g2, (w, h))).mean()


def find_cycle(frames, masks, steady=(12, 105), period_range=(70, 120), step=4, min_iou=0.80):
    """Return (s, e) same-phase pair; the sheet cycle is [s, e-step]."""
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
        raise RuntimeError("no same-phase gait pair found - regenerate the loop video")
    best.sort(reverse=True)
    return best[0][1], best[0][2]


def key_frame(f, threshold=248, feather=0.3):
    b = f[..., 0].astype(int)
    g = f[..., 1].astype(int)
    r = f[..., 2].astype(int)
    white = ((r > threshold) & (g > threshold) & (b > threshold)).astype(np.uint8)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = (1 - white) * 255
    if feather > 0:
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (3, 3), feather)
    return np.clip(alpha, 0, 255).astype(np.uint8)


def build_sheet(frames, cells, step, target_h, feet_y, center_x, cell_size, cols, gif_path=None,
                threshold=248, feather=0.3, fixed_scale=False):
    ref_scale = None
    if fixed_scale:
        alpha0 = key_frame(frames[cells[0]], threshold=threshold, feather=feather)
        ys0, xs0 = np.where(alpha0 > 30)
        ref_h = ys0.max() - ys0.min() + 1
        ref_scale = target_h / max(1, ref_h)
    out_cells = []
    for k in cells:
        alpha = key_frame(frames[k], threshold=threshold, feather=feather)
        f = frames[k]
        ys, xs = np.where(alpha > 30)
        if len(xs) == 0:
            raise RuntimeError(f"empty cell from frame {k}")
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        crop = f[y0 : y1 + 1, x0 : x1 + 1]
        a = alpha[y0 : y1 + 1, x0 : x1 + 1]
        ch = y1 - y0 + 1
        if fixed_scale:
            scale = ref_scale
            nh = max(1, round(ch * scale))
            nw = max(1, round((x1 - x0 + 1) * scale))
        else:
            scale = target_h / ch
            nh = target_h
            nw = max(1, round((x1 - x0 + 1) * scale))
        crop = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
        a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
        cell = np.zeros((cell_size, cell_size, 4), np.uint8)
        ox = center_x - nw // 2
        oy = feet_y - nh + 1
        if oy >= 0 and oy + nh <= cell_size:
            cell[oy : oy + nh, ox : ox + nw] = np.dstack([crop, a])
        out_cells.append(cell)

    n = len(out_cells)
    rows = []
    for r in range(int(np.ceil(n / cols))):
        row_cells = out_cells[r * cols : (r + 1) * cols]
        if len(row_cells) < cols:
            blank = np.zeros((cell_size, cell_size, 4), np.uint8)
            row_cells = row_cells + [blank] * (cols - len(row_cells))
        rows.append(np.hstack(row_cells))
    sheet = np.vstack(rows)
    if gif_path:
        mag = np.array([255, 0, 255], np.uint8)
        pv = []
        for c in out_cells:
            rgb = c[..., :3].astype(int)
            a = c[..., 3:4].astype(int) / 255
            pv.append(Image.fromarray((rgb * a + mag * (1 - a)).astype(np.uint8)))
        pv[0].save(gif_path, save_all=True, append_images=pv[1:],
                   duration=int(step * 1000 / 24), loop=0)
    return sheet, out_cells


def main():
    ap = argparse.ArgumentParser(description="H3 loop video -> seamless sprite sheet")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--out-gif", default=None)
    ap.add_argument("--step", type=int, default=4, help="sample every Nth frame (24fps)")
    ap.add_argument("--target-h", type=int, default=262, help="character height in cell")
    ap.add_argument("--feet-y", type=int, default=410, help="feet baseline y in cell")
    ap.add_argument("--center-x", type=int, default=256, help="horizontal center in cell")
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--cols", type=int, default=5)
    ap.add_argument("--steady", default="12,105", help="steady middle scan range s0,s1")
    ap.add_argument("--period", default="70,120", help="gait period scan range P0,P1")
    ap.add_argument("--min-iou", type=float, default=0.80)
    ap.add_argument("--threshold", type=int, default=248,
                    help="white background threshold (0-255); H3 videos bg ~254-255, use 248")
    ap.add_argument("--feather", type=float, default=0.3,
                    help="alpha edge feather sigma; 0 = hard mask (no white halo)")
    ap.add_argument("--fixed-scale", action="store_true",
                    help="use first cell scale for all frames (uniform body size; pose deform preserved)")
    args = ap.parse_args()

    frames = load_frames(args.video)
    masks = bg_masks(frames, threshold=args.threshold)
    s0, s1 = (int(x) for x in args.steady.split(","))
    p0, p1 = (int(x) for x in args.period.split(","))
    s, e = find_cycle(frames, masks, steady=(s0, s1), period_range=(p0, p1),
                      step=args.step, min_iou=args.min_iou)
    cells = list(range(s, e - args.step + 1, args.step))
    print(f"[h3-loop] same-phase pair: s={s} e={e} (period {e - s}), "
          f"cycle cells [{cells[0]}..{cells[-1]}] x{len(cells)}", flush=True)

    # verify seam is a normal step
    steps = [body_diff(frames[k], frames[k + args.step], 1.0) for k in cells[:-1]]
    seam = body_diff(frames[cells[-1]], frames[cells[0]], 1.0)
    print(f"[h3-loop] normal steps mean={np.mean(steps):.1f} range=[{min(steps):.1f},{max(steps):.1f}] "
          f"seam={seam:.1f}", flush=True)
    if not (min(steps) <= seam <= max(steps) * 1.5):
        print("[h3-loop] WARNING: seam step outside normal range - check the GIF preview", flush=True)

    sheet, cells_out = build_sheet(frames, cells, args.step, args.target_h, args.feet_y,
                                   args.center_x, args.cell, args.cols, args.out_gif,
                                   args.threshold, args.feather, args.fixed_scale)
    cv2.imwrite(args.out, sheet)
    print(f"[h3-loop] sheet {sheet.shape} -> {args.out}  ({len(cells_out)} frames)", flush=True)

    # alignment stats
    feets, cents, hs = [], [], []
    for c in cells_out:
        a = c[..., 3]
        ys, xs = np.where(a > 30)
        feets.append(ys.max())
        cents.append((xs.min() + xs.max()) / 2)
        hs.append(ys.max() - ys.min() + 1)
    print(f"[h3-loop] alignment: feet=[{min(feets)},{max(feets)}] center_x=[{min(cents):.0f},{max(cents):.0f}] "
          f"height=[{min(hs)},{max(hs)}]", flush=True)


if __name__ == "__main__":
    main()
