#!/usr/bin/env python3
"""luna 角色视频 -> 32 帧精灵图（BiRefNet 抠图 + 对齐三铁律 + 拼 sheet）。

用法（必须用 ComfyUI venv python 且工作目录为 tools/ai-gen）：
  python luna-sprite-builder.py --frames-dir <无中文路径帧目录> --indices 0,3,6,... \
      --name walking --out <最终 sheet.png> [--cols 8] [--cell 512] \
      [--target-h 460] [--feet-y 480] [--center-x 256]

帧目录为已抽出的 PNG（f_001.png 起始，1 基编号）；--indices 用 0 基帧号。
产物由调用方 Copy-Item 到中文路径；本脚本只处理 ASCII 路径（SKILL 中文路径教训）。
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image

import rmbg_cutout
from rmbg_cutout import get_model, predict_alpha


def load_frame(path):
    return Image.open(path).convert("RGB")


def make_rgba(rgb, alpha):
    """去污染合成：边缘 alpha 反推前景色（unpremultiply），防白边/灰边。"""
    a = alpha.astype(np.float32) / 255.0
    a3 = np.clip(a, 1e-4, 1.0)[..., None]
    rgb_f = np.array(rgb, dtype=np.float32)
    out_rgb = np.clip(rgb_f / a3, 0, 255).astype(np.uint8)
    out_a = (alpha.astype(np.uint8))
    return np.dstack([out_rgb, out_a])


def bbox_bottom(rgba):
    """alpha bbox 底边 y（0 基，含端点）。"""
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return None
    return int(ys.max())


def align_cell(rgba, target_h, feet_y, center_x, cell, ground_y=None):
    """对齐三铁律：统一高度、脚底基线（或地面相对高度）、水平中心。

    ground_y=None 时脚底固定到 feet_y（地面循环动画）；
    ground_y 给定时保持各帧与地面基准的相对高度（跳跃动画，空中帧脚底高于 feet_y）。
    """
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        blank = np.zeros((cell, cell, 4), np.uint8)
        return blank, None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    h = y1 - y0
    if h <= 0:
        blank = np.zeros((cell, cell, 4), np.uint8)
        return blank, None
    scale = target_h / h
    # 缩放后宽高（含 bbox 端点，与 crop 尺寸一致）
    nw = max(1, int(round((x1 - x0 + 1) * scale)))
    nh = max(1, int(round((y1 - y0 + 1) * scale)))
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    resized = np.array(Image.fromarray(crop).resize((nw, nh), Image.LANCZOS))
    # 对齐三铁律：缩放后 bbox 中心 = center_x；底边 = feet_y（或 feet_y - 离地高度）
    ox = int(round(center_x - nw / 2.0))
    if ground_y is not None:
        oy = int(round(feet_y - (ground_y - (y1 + 1)) * scale - nh))
    else:
        oy = int(round(feet_y - nh))
    out = np.zeros((cell, cell, 4), np.uint8)
    sx0, sy0 = max(0, -ox), max(0, -oy)
    dx0, dy0 = max(0, ox), max(0, oy)
    w = min(nw - sx0, cell - dx0)
    hh = min(nh - sy0, cell - dy0)
    if w > 0 and hh > 0:
        out[dy0:dy0 + hh, dx0:dx0 + w] = resized[sy0:sy0 + hh, sx0:sx0 + w]
    stats = {
        "h": nh,
        "feet_y": oy + nh,
        "center_x": ox + nw / 2.0,
        "alpha_px": int((alpha > 16).sum()),
    }
    return out, stats


def build_sheet(frames_dir, indices, name, out_path, cell, cols,
                target_h, feet_y, center_x, align):
    model = get_model()
    rgba_list = []
    for k, idx in enumerate(indices):
        fname = f"f_{idx + 1:03d}.png"
        fpath = os.path.join(frames_dir, fname)
        rgb = load_frame(fpath)
        alpha = predict_alpha(model, rgb)
        rgba_list.append(make_rgba(rgb, alpha))
        print(f"[luna] {name} {k + 1}/{len(indices)} frame {idx} cutout ok", flush=True)

    # 跳跃动画：以序列中最低脚底为地面基准，保持离地高度
    ground_y = None
    if align == "ground":
        bottoms = [bbox_bottom(r) for r in rgba_list]
        valid = [b for b in bottoms if b is not None]
        if valid:
            ground_y = max(valid)
        print(f"[luna] ground-relative align, ground_y={ground_y}", flush=True)

    cells = []
    stats_list = []
    for k, rgba in enumerate(rgba_list):
        cell_img, st = align_cell(rgba, target_h, feet_y, center_x, cell, ground_y)
        cells.append(cell_img)
        stats_list.append(st)
        print(f"[luna] {name} {k + 1}/{len(indices)} aligned ok", flush=True)

    rows = int(np.ceil(len(cells) / cols))
    sheet = np.zeros((rows * cell, cols * cell, 4), np.uint8)
    for k, c in enumerate(cells):
        r, col = divmod(k, cols)
        sheet[r * cell:(r + 1) * cell, col * cell:(col + 1) * cell] = c

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(out_path)
    print(f"[luna] sheet {sheet.shape} -> {out_path} ({len(cells)} frames)", flush=True)

    # 验证统计
    heights = [s["h"] for s in stats_list if s]
    feets = [s["feet_y"] for s in stats_list if s]
    cents = [s["center_x"] for s in stats_list if s]
    empties = [k for k, s in enumerate(stats_list) if not s or s["alpha_px"] < 50]
    print(f"[luna] align: h mean={np.mean(heights):.1f} std={np.std(heights):.1f} "
          f"feet mean={np.mean(feets):.1f} std={np.std(feets):.1f} "
          f"center mean={np.mean(cents):.1f} std={np.std(cents):.1f}", flush=True)
    if empties:
        print(f"[luna] WARNING empty cells: {empties}", flush=True)
    return sheet


def main():
    ap = argparse.ArgumentParser(description="luna 视频 -> 32 帧精灵图")
    ap.add_argument("--frames-dir", required=True)
    ap.add_argument("--indices", required=True, help="逗号分隔 0 基帧号")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--target-h", type=int, default=460)
    ap.add_argument("--feet-y", type=int, default=480)
    ap.add_argument("--center-x", type=int, default=256)
    ap.add_argument("--align", choices=["feet", "ground"], default="feet",
                    help="feet=脚底基线固定（走/跑/施法）；ground=地面相对高度（跳跃）")
    args = ap.parse_args()

    indices = [int(x) for x in args.indices.split(",")]
    build_sheet(args.frames_dir, indices, args.name, args.out,
                args.cell, args.cols, args.target_h, args.feet_y, args.center_x, args.align)


if __name__ == "__main__":
    main()
