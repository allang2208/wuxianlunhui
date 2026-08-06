#!/usr/bin/env python3
"""Extract an attack sprite sheet from an H3 first/last-frame attack video.

H3 attack videos (first_frame == last_frame == idle) are one-shot arcs:
idle -> attack motion -> return to idle. This tool picks the frames that
actually contain the attack (explicit frame list or --window detection),
keys out the white background, and aligns every cell to the same conventions
as h3-loop-spritesheet.py (fixed character height / feet baseline), while
PRESERVING the horizontal lunge (per-frame horizontal offset relative to the
reference frame 0) so the wolf visibly leaps/bites forward.

Usage (run with the ComfyUI venv python - it has cv2):
    .venv\\Scripts\\python.exe tools/ai-gen/h3-attack-spritesheet.py ^
        --video <attack.mp4> --out <sheet.png> [--cols 4] [--frames 21,24,27,30,33,36,39,42]

Without --frames, it auto-detects the active window (frames whose wolf mask
differs from frame 0 by more than --min-diff) and samples it uniformly.

Chinese output paths: write to %TEMP% then Copy-Item to the final location.
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


def key_frame(f, threshold=248, feather=0.3):
    white = ((f[..., 0] > threshold) & (f[..., 1] > threshold) & (f[..., 2] > threshold)).astype(np.uint8)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = (1 - white) * 255
    if feather > 0:
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (3, 3), feather)
    return np.clip(alpha, 0, 255).astype(np.uint8)


def detect_attack_frames(frames, min_diff=0.10, min_frames=6):
    """Return a uniformly sampled frame list covering the active attack window."""
    m0 = bg_masks([frames[0]])[0]
    n = len(frames)
    active = []
    for i in range(n):
        mi = bg_masks([frames[i]])[0]
        inter = np.logical_and(mi, m0).sum()
        union = np.logical_or(mi, m0).sum()
        diff = 1 - inter / max(1, union)
        if diff > min_diff:
            active.append(i)
    if not active:
        raise RuntimeError("no active attack frames detected - check the video")
    start, end = active[0], active[-1]
    if end - start + 1 < min_frames:
        raise RuntimeError(f"attack window too short: [{start},{end}]")
    # sample ~8-12 frames uniformly across the window
    count = min(12, max(min_frames, (end - start) // 3 + 1))
    step = (end - start) / max(1, count - 1)
    idxs = [start + round(i * step) for i in range(count)]
    return sorted(set(idxs)), start, end


def build_sheet(frames, idxs, out, cols, target_h=262, feet_y=410, center_x=256,
                cell_size=512, out_gif=None, threshold=248, feather=0.3,
                fixed_scale=True):
    """Build attack sheet; horizontal offset preserves the lunge vs frame 0.

    fixed_scale=True (default): all frames use the SAME scale as the reference
    frame (frame 0), so the wolf stays the same on-screen size as idle and the
    lunge/lean reads as pose change, not zoom. Per-frame height rescaling
    (fixed_scale=False) was found to magnify crouch frames and clip wide
    pounce frames (2026-08-06 black wolf bite feedback).
    """
    a0 = key_frame(frames[0], threshold=threshold, feather=feather)
    ys0, xs0 = np.where(a0 > 30)
    ref_cx = (xs0.min() + xs0.max()) / 2
    ref_h = ys0.max() - ys0.min() + 1
    fixed_scale_val = target_h / max(1, ref_h) if fixed_scale else None
    cells = []
    for k in idxs:
        alpha = key_frame(frames[k], threshold=threshold, feather=feather)
        f = frames[k]
        ys, xs = np.where(alpha > 30)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        crop = f[y0:y1 + 1, x0:x1 + 1]
        a = alpha[y0:y1 + 1, x0:x1 + 1]
        ch = y1 - y0 + 1
        if fixed_scale:
            scale = fixed_scale_val
            nh = max(1, round(ch * scale))
            nw = max(1, round((x1 - x0 + 1) * scale))
        else:
            scale = target_h / ch
            nh = target_h
            nw = max(1, round((x1 - x0 + 1) * scale))
        crop = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
        a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
        cx = (x0 + x1) / 2
        dx = round((cx - ref_cx) * scale)  # preserve horizontal lunge
        cell = np.zeros((cell_size, cell_size, 4), np.uint8)
        ox = int(center_x - nw // 2 + dx)
        oy = int(feet_y - nh + 1)
        # 防裁切：内容优先完整，clamp 到 cell 内（不裁剪）
        ox = max(0, min(ox, cell_size - nw))
        if ox + nw <= cell_size and oy + nh <= cell_size and oy >= 0:
            cell[oy:oy + nh, ox:ox + nw] = np.dstack([crop, a])
        else:
            print(f"[h3-attack] WARN frame {k} too large for cell "
                  f"({nw}x{nh} at {ox},{oy}) - skipped")
        cells.append(cell)
    while len(cells) % cols != 0:
        cells.append(np.zeros((cell_size, cell_size, 4), np.uint8))
    rows = [np.hstack(cells[r * cols:(r + 1) * cols]) for r in range(len(cells) // cols)]
    sheet = np.vstack(rows)
    cv2.imwrite(out, sheet)
    if out_gif:
        pv = []
        mag = np.array([255, 0, 255], np.uint8)
        for c in cells:
            rgb = c[..., :3].astype(int)
            al = c[..., 3:4].astype(int) / 255
            pv.append(np.clip(rgb * al + mag * (1 - al), 0, 255).astype(np.uint8))
        from PIL import Image
        pv[0] = Image.fromarray(pv[0])
        for i in range(1, len(pv)):
            pv[i] = Image.fromarray(pv[i])
        pv[0].save(out_gif, save_all=True, append_images=pv[1:], duration=100, loop=0)
    feets, cents, hs = [], [], []
    for c in cells:
        aa = c[..., 3]
        ys2, xs2 = np.where(aa > 30)
        if len(xs2):
            feets.append(int(ys2.max()))
            cents.append((xs2.min() + xs2.max()) / 2)
            hs.append(int(ys2.max() - ys2.min() + 1))
    print(f"[h3-attack] {len(idxs)} frames -> {out} {sheet.shape}")
    print(f"[h3-attack] alignment: feet=[{min(feets)},{max(feets)}] "
          f"center_x=[{min(cents):.0f},{max(cents):.0f}] height=[{min(hs)},{max(hs)}]")


def main():
    ap = argparse.ArgumentParser(description="H3 attack video -> sprite sheet")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--out-gif", default=None)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--frames", default=None, help="comma list, e.g. 21,24,27,30,33,36,39,42")
    ap.add_argument("--min-diff", type=float, default=0.10)
    ap.add_argument("--target-h", type=int, default=262)
    ap.add_argument("--feet-y", type=int, default=410)
    ap.add_argument("--center-x", type=int, default=256)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--threshold", type=int, default=248)
    ap.add_argument("--feather", type=float, default=0.3)
    ap.add_argument("--fixed-scale", type=int, default=1,
                    help="1=所有帧用首帧同比例缩放(推荐,防误放大/裁切); 0=逐帧缩放到 target_h")
    args = ap.parse_args()

    frames = load_frames(args.video)
    if args.frames:
        idxs = [int(x) for x in args.frames.split(",")]
    else:
        idxs, start, end = detect_attack_frames(frames, min_diff=args.min_diff)
        print(f"[h3-attack] detected window [{start},{end}] -> {len(idxs)} frames", flush=True)
    build_sheet(frames, idxs, args.out, args.cols, args.target_h, args.feet_y,
                args.center_x, args.cell, args.out_gif, args.threshold, args.feather,
                args.fixed_scale == 1)


if __name__ == "__main__":
    main()
