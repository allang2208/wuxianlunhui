#!/usr/bin/env python3
"""H3 视频抽帧 → BiRefNet 抠图重建 sheet（黑狼白边教训，2026-08-07 红狼王应用）。

阈值 235+羽化必留白边；正式入库一律走本管线：
  - 逐帧 BiRefNet alpha（模型 ComfyUI/models/BiRefNet/MS-BiRefNet，用 ComfyUI venv python 跑）；
  - alpha = max(BiRefNet, 阈值mask(248))（腿部/浅毛兜底）；
  - 去污染：亮半透像素（lum>150 且 alpha<245）清零，白色半透明直接清零；
  - bbox 用阈值 mask bbox（完整狼，防 BiRefNet 丢腿）；
  - fixed_scale：全部帧用首帧同比例缩放（与 idle 恒等尺寸，攻击不放大）。

用法（ComfyUI venv python）：
  python rebuild-h3-birefnet.py --video x.mp4 --out sheet.png --frames 21,24,27...
      [--cols 4] [--target-h 262] [--feet-y 410] [--center-x 256] [--cell 512]
      [--threshold 248] [--min-diff 0.10] [--lum-clear 150]
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image
import torch

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)
from rmbg_cutout import get_model, predict_alpha as rmbg_predict_alpha  # noqa: E402


def load_model():
    model = get_model()
    device = model.device
    return model, device


def predict_alpha(model, device, pil):
    return rmbg_predict_alpha(model, pil)


def parse_hex_color(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def load_frames(video_path):
    cap = cv2.VideoCapture(video_path)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    return frames


def detect_window(frames, min_diff=0.10):
    g0 = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY).astype(float)
    diffs = []
    for f in frames:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(float)
        diffs.append(np.abs(cv2.resize(g, (64, 64)) - cv2.resize(g0, (64, 64))).mean())
    diff = np.array(diffs)
    peak = int(diff.argmax())
    window = [i for i in range(len(frames)) if diff[i] > min_diff * diff[peak]]
    if not window:
        window = list(range(len(frames)))
    return window


def sample_idxs(window, n, total):
    """在动作窗口内均匀抽取 n 帧（含首尾），与红狼王 12 帧惯例同一策略。"""
    idxs = [window[0] + round((window[-1] - window[0]) * i / (n - 1)) for i in range(n)]
    return sorted(set(max(0, min(total - 1, i)) for i in idxs))


def post_clean_sheet(sheet, cell, hard=245, edge_dark=18, bg=None, bg_dist=20):
    """逐格后处理（黑狼 CLEAN 铁律，2026-08-08 内置到 rebuild）：
    1) alpha 硬二值化（>=245 -> 255，清 resize 插值半透带）；
    2) 每格只保留最大连通域（清孤立噪点色块）；
    3) 不透明亮像素邻接透明区（2px 膨胀）压暗到 edge_dark（清 resize 白圈）；
    4) 腿部区域（bbox 底部 35%）近背景像素 -> 5x5 邻域毛色均值（清脚底贴地残留）；
    5) 透明区 RGB 归零。
    """
    if bg is None:
        bg = np.array([255.0, 255.0, 255.0])
    rgb = sheet[..., :3].copy()
    alpha = sheet[..., 3].copy()
    h, w = alpha.shape
    rows, cols = h // cell, w // cell
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = alpha[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            a_bin = np.where(ac >= hard, 255, 0).astype(np.uint8)
            # 最大连通域
            n_lab, lab = cv2.connectedComponents((a_bin > 30).astype(np.uint8))
            if n_lab > 2:
                areas = [(int((lab == i).sum()), i) for i in range(1, n_lab)]
                areas.sort(reverse=True)
                keep = areas[0][1]
                drop = (lab > 0) & (lab != keep)
                a_bin[drop] = 0
                rc[drop] = 0
            # 边缘近背景像素压暗（resize 白圈/背景混边）
            dist_bg = np.linalg.norm(rc.astype(np.float64) - bg, axis=2)
            lum = rc.mean(axis=2)
            opaque = a_bin >= 250
            bright = opaque & ((dist_bg < bg_dist) | (lum > 150))
            trans = (a_bin < 200).astype(np.uint8)
            near = cv2.dilate(trans, np.ones((3, 3), np.uint8), iterations=2) > 0
            rc[near & bright] = edge_dark
            # 腿部区域去残留（bbox 底部 35% 内近背景像素 -> 邻域毛色均值）
            ys, xs = np.where(a_bin >= 200)
            if len(ys):
                y0b, y1b = ys.min(), ys.max()
                cut = max(0, y0b + int((y1b - y0b) * 0.65))
                band = np.zeros_like(a_bin, bool)
                band[cut:y1b + 1, :] = True
                bright_leg = band & (a_bin >= 200) & ((dist_bg < bg_dist) | (lum > 160))
                if bright_leg.any():
                    dark = (a_bin >= 200) & (~bright_leg)
                    cnt = cv2.blur(dark.astype(np.float32), (5, 5)) * 25.0
                    mean = np.stack([
                        cv2.blur((rc[..., i] * dark).astype(np.float32), (5, 5)) * 25.0
                        for i in range(3)
                    ], axis=-1) / np.maximum(cnt[..., None], 1e-6)
                    mean = np.clip(mean, 0, 255).astype(np.uint8)
                    mean[cnt < 1] = edge_dark
                    rc[bright_leg] = mean[bright_leg]
            # 透明区 RGB 归零
            rc[a_bin < 8] = 0
            ac[...] = a_bin
    return np.dstack([rgb, alpha]).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames", default=None, help="comma list; default auto 12")
    ap.add_argument("--frames-count", type=int, default=12,
                    help="auto sample N frames in the action window (default 12)")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--target-h", type=int, default=262)
    ap.add_argument("--feet-y", type=int, default=410)
    ap.add_argument("--center-x", type=int, default=256)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--threshold", type=int, default=248)
    ap.add_argument("--min-diff", type=float, default=0.10)
    ap.add_argument("--lum-clear", type=int, default=200,
                    help="半透像素亮度上限：超过且 alpha<250 清零（只清近白边，保浅色毛）")
    ap.add_argument("--scale", type=float, default=None,
                    help="显式固定缩放（如 0.624 = idle 参考）；缺省用首帧自动算")
    ap.add_argument("--uniform-h", action="store_true",
                    help="逐帧缩放到 target_h（高度统一，黑狼步态同款；宽度随姿态）")
    ap.add_argument("--fixed-bbox", action="store_true",
                    help="用全序列联合 bbox 固定裁切/腿部兜底区域（防 BiRefNet 单帧 bbox 收紧裁掉肢体）")
    ap.add_argument("--hard-edge", type=int, default=0,
                    help="黑狼硬边：alpha<该值清零（黑狼 CLEAN 惯例 245；0=关闭保留软边）")
    ap.add_argument("--edge-dark", type=int, default=-1,
                    help="轮廓边缘亮像素压暗到该色（黑狼 18；<0 关闭）")
    ap.add_argument("--zero-transparent-rgb", action="store_true",
                    help="透明区 RGB 归零（黑狼 CLEAN 判据 trans_nonblack=0）")
    ap.add_argument("--no-auto-clean", action="store_true",
                    help="关闭重建后逐格自动清理（默认开启：硬二值化/最大连通域/边缘压暗/腿部去白）")
    ap.add_argument("--bg-color", default="#FFFFFF",
                    help="背景色 #RRGGBB（强制用主体没有的颜色做底，默认白；阈值兜底/去污染按此色自适应）")
    ap.add_argument("--bg-dist", type=float, default=20.0,
                    help="与背景色的距离阈值（> 此值判为主体，默认 20）")
    args = ap.parse_args()

    frames = load_frames(args.video)
    if args.frames:
        idxs = [int(x) for x in args.frames.split(",")]
    else:
        window = detect_window(frames, args.min_diff)
        idxs = sample_idxs(window, args.frames_count, len(frames))
    print(f"[rebuild] {len(frames)} frames, select {len(idxs)}: {idxs}", flush=True)
    model, device = load_model()

    if args.scale:
        fixed_scale = args.scale
        print(f"[rebuild] fixed_scale={fixed_scale:.3f} (explicit)", flush=True)
    else:
        ref_alpha = predict_alpha(model, device, Image.fromarray(cv2.cvtColor(frames[idxs[0]], cv2.COLOR_BGR2RGB)))
        ref_gray = cv2.cvtColor(frames[idxs[0]], cv2.COLOR_BGR2GRAY)
        ref_thr = (ref_gray > args.threshold).astype(np.uint8)
        ref_mask = (ref_alpha > 30) | (ref_thr == 0)
        ys0, xs0 = np.where(ref_mask)
        ref_h = ys0.max() - ys0.min() + 1
        fixed_scale = args.target_h / max(1, ref_h)
        print(f"[rebuild] fixed_scale={fixed_scale:.3f} (ref_h={ref_h})", flush=True)

    # 全序列联合 bbox（灰度<245 白底 mask），固定裁切与腿部兜底区域
    bb = None
    if args.fixed_bbox:
        x0s, y0s, x1s, y1s = [], [], [], []
        for f in frames:
            g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
            ys, xs = np.where(g < 245)
            if len(xs):
                x0s.append(xs.min()); x1s.append(xs.max()); y0s.append(ys.min()); y1s.append(ys.max())
        if x0s:
            bb = (min(x0s), min(y0s), max(x1s), max(y1s))
            print(f"[rebuild] fixed bbox={bb}", flush=True)

    out_cells = []
    bg_rgb = parse_hex_color(args.bg_color)
    bg_is_white = float(bg_rgb.mean()) > 250
    for k in idxs:
        frame = frames[k]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        alpha_b = predict_alpha(model, device, pil)
        # 与背景色的距离（阈值兜底/腿部兜底/去污染统一按此）
        dist_bg = np.linalg.norm(rgb.astype(np.float64) - bg_rgb, axis=2)
        # 合成：max(BiRefNet, 背景色距离阈值兜底) —— 距离 > bg_dist 强制主体，
        # 距离 bg_dist 附近（压缩混合边）交给 BiRefNet 判定（防留底边）
        alpha_thr = (dist_bg > args.bg_dist).astype(np.uint8) * 255
        # 腿部区域阈值兜底（run 低伏奔跑腿部运动模糊，与背景色距离不足、
        # BiRefNet 对模糊腿 alpha 不稳 -> 腿型逐帧抖动）：bbox 底部 35% 内
        # 用同一距离阈值强制主体，底边由后处理清理
        alpha_leg = np.zeros_like(alpha_b)
        ys, xs = np.where(alpha_b > 30)
        if bb:
            y0, y1 = bb[1], bb[3]
            cut = max(0, y0 + int((y1 - y0) * 0.65))
            leg_region = np.zeros_like(alpha_b, bool)
            leg_region[cut:y1 + 1, :] = True
            alpha_leg[leg_region & (dist_bg > args.bg_dist)] = 255
        elif len(ys):
            y0, y1 = ys.min(), ys.max()
            cut = max(0, y0 + int((y1 - y0) * 0.65))
            leg_region = np.zeros_like(alpha_b, bool)
            leg_region[cut:y1 + 1, :] = True
            alpha_leg[leg_region & (dist_bg > args.bg_dist)] = 255
        alpha = np.maximum.reduce([alpha_b, alpha_thr, alpha_leg]).astype(np.uint8)
        # 去污染：半透像素反推前景色后仍接近背景 -> 清半透（白底走旧 lum 逻辑兼容）
        a = alpha.astype(np.float64) / 255.0
        inv = 1.0 - a
        fg = (rgb.astype(np.float64) - inv[..., None] * bg_rgb) / np.maximum(a[..., None], 1e-3)
        fg = np.clip(fg, 0, 255)
        dist_fg_bg = np.linalg.norm(fg - bg_rgb, axis=2)
        if bg_is_white:
            lum = rgb.astype(int).mean(axis=2)
            light_semi = (lum > args.lum_clear) & (alpha < 250)
        else:
            light_semi = (dist_fg_bg < args.bg_dist) & (alpha < 250)
        alpha[light_semi] = 0
        # 黑狼硬边：清除剩余半透（alpha<245 全部清零，接受轻微锯齿——黑狼十五版惯例）
        if args.hard_edge > 0:
            alpha[alpha < args.hard_edge] = 0
        # 轮廓边缘不透明亮像素压暗（黑狼十六版：边缘白边残留 → 黑毛色）
        if args.edge_dark >= 0:
            hh, ww = alpha.shape
            opaque = alpha >= 250
            bright = opaque & (rgb.astype(int).mean(axis=2) > 150)
            trans = alpha < 200
            big = trans.astype(np.uint8)
            near = np.zeros((hh, ww), bool)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    near |= (np.roll(np.roll(big, dy, axis=0), dx, axis=1) > 0)
            rgb[near & bright] = args.edge_dark
        # 透明区 RGB 归零（黑狼 CLEAN 判据）
        if args.zero_transparent_rgb:
            rgb[alpha < 8] = 0
        # bbox 用合成 alpha（排除 235~248 灰白背景噪点；完整狼含腿部/压低帧）
        if bb:
            x0, y0, x1, y1 = bb
        else:
            bbox_mask = (alpha > 30)
            ys, xs = np.where(bbox_mask)
            if len(xs) == 0:
                ys, xs = np.where(alpha > 30)
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        ch = y1 - y0 + 1
        cw = x1 - x0 + 1
        if args.uniform_h:
            fscale = args.target_h / max(1, ch)
            nh = args.target_h
        else:
            fscale = fixed_scale
            nh = max(1, round(ch * fixed_scale))
        nw = max(1, round(cw * fscale))
        if rgb[y0:y1+1, x0:x1+1].size == 0:
            print(f"[rebuild] DEBUG k={k} bb={bb} rgb={rgb.shape} y0={y0} y1={y1} x0={x0} x1={x1}", flush=True)
        crop = cv2.resize(rgb[y0:y1+1, x0:x1+1], (nw, nh), interpolation=cv2.INTER_AREA)
        a = cv2.resize(alpha[y0:y1+1, x0:x1+1], (nw, nh), interpolation=cv2.INTER_AREA)
        cell = np.zeros((args.cell, args.cell, 4), np.uint8)
        ox = args.center_x - nw // 2
        oy = args.feet_y - nh + 1
        if oy >= 0 and oy + nh <= args.cell and ox >= 0 and ox + nw <= args.cell:
            cell[oy:oy+nh, ox:ox+nw] = np.dstack([crop, a])
        else:
            print(f"[rebuild] WARN frame {k} too large {nw}x{nh} at {ox},{oy} - clamp")
            ox = max(0, min(ox, args.cell - nw))
            oy = max(0, min(oy, args.cell - nh))
            if oy + nh <= args.cell and ox + nw <= args.cell:
                cell[oy:oy+nh, ox:ox+nw] = np.dstack([crop, a])
        out_cells.append(cell)

    n = len(out_cells)
    rows = []
    for r in range(int(np.ceil(n / args.cols))):
        row_cells = out_cells[r*args.cols:(r+1)*args.cols]
        if len(row_cells) < args.cols:
            blank = np.zeros((args.cell, args.cell, 4), np.uint8)
            row_cells = row_cells + [blank] * (args.cols - len(row_cells))
        rows.append(np.hstack(row_cells))
    sheet = np.vstack(rows)
    if not args.no_auto_clean:
        sheet = post_clean_sheet(sheet, args.cell,
                                 bg=parse_hex_color(args.bg_color), bg_dist=args.bg_dist)
        print("[rebuild] auto-clean done", flush=True)
    # cv2.imwrite 按 BGR 解析数组——RGBA 直接写会把 RGB 通道翻转成蓝色（红狼变蓝 bug）：
    # 必须用 PIL 保存（PIL 正确解释 RGBA）
    Image.fromarray(sheet, "RGBA").save(args.out)
    print(f"[rebuild] sheet {sheet.shape} -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
