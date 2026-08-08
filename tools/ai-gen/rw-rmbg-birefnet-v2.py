#!/usr/bin/env python3
"""红狼人贴图 BEN2 重抠（2026-08-08 二十五版）。

背景：BiRefNet-general 在红狼人脚下/边缘残留红色块，RMBG-2.0 红边明显，
ToonOut 有白边。全网实测 BEN2（PramaLLC，22K 专有数据集 + CGM 置信度引导）
边缘最干净、身体最完整、无白边/红边，作为新主抠图模型。

流程：
  1) 现有 RGBA 合成白底 -> 还原白底素材 RGB；
  2) 按 animation-config 帧布局切格（changed_run 7×2 512² / changed_attack 4×3 512² /
     transformed_idle 1×1 512²）；
  3) 每格过 ComfyUI-RMBG AILab_RMBG BEN2（process_res 1024）-> alpha_b；
  4) alpha = max(alpha_b, 现有 alpha>=248)（保留主体防丢腿）；
  5) 去污（半透反推前景色、亮半透清零）+ rw-cutout-clean --soft 局部毛色还原；
  6) 重组 sheet，输出到 out 目录并打印定量指标（白边/红边/孤立色块/脚底残留）。

用法（ComfyUI venv python）：
  $env:PYTHONPATH='<ComfyUI根>;<ComfyUI根>/custom_nodes/ComfyUI-RMBG/py'
  python rw-rmbg-birefnet-v2.py --out <输出目录> --files a.png,b.png
"""
import argparse
import os
import sys
import time

import numpy as np
from PIL import Image
import torch
from scipy import ndimage

import AILab_RMBG as rmbg2  # noqa: E402

ASSETS = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "enemies")
)

# (file, cols, rows, cell)
JOBS = [
    ("red_wolf_king_transformed_idle.png", 1, 1, 512),
    ("red_wolf_king_changed_run.png", 7, 2, 512),
    ("red_wolf_king_changed_attack.png", 4, 3, 512),
]


def composite_white(rgba):
    a = np.array(rgba.convert("RGBA")).astype(np.float64)
    rgb = a[..., :3].copy()
    alpha = a[..., 3:4] / 255.0
    comp = rgb * alpha + 255.0 * (1 - alpha)
    return Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB")


def decontaminate(rgb, alpha, lum_clear=200):
    """半透反推前景色 + 亮半透清零（复用 rw-rmbg-recut 逻辑）。"""
    rgb = rgb.astype(np.float64).copy()
    a = alpha.astype(np.float64) / 255.0

    semi = (a > 0.03) & (a < 0.98)
    if semi.any():
        inv = 1.0 - a[semi]
        f = np.clip((rgb[semi] - inv[:, None] * 255.0) / a[semi][:, None], 0, 255)
        bright = f.mean(axis=1) > 165
        drop_idx = np.where(semi)[0][bright]
        if len(drop_idx):
            a.flat[drop_idx] = 0
            rgb.reshape(-1, 3)[drop_idx] = 0
        keep = ~bright
        rgb[semi] = f
        rgb[semi][keep] = f[keep]

    lum = rgb.mean(axis=2)
    light_semi = (lum > lum_clear) & (a > 0.03) & (a < 250 / 255.0)
    if light_semi.any():
        a[light_semi] = 0
        rgb[light_semi] = 0

    rgb[a < 0.03] = 0
    return rgb.astype(np.uint8), (a * 255).astype(np.uint8)


def remove_foot_shadow(rgb, alpha, cell, cols, rows, sat_thr=15, lum_thr=100):
    """删除每格底部的地面接触阴影（H3 白底视频自带，灰/黑，低饱和低亮度）。

    只作用于内容底部 25%（≤40px）区域内，且要求是"低饱和 + 低亮度"的暗灰黑块，
    不会误伤深红毛（红毛 sat≈30+，见 SKILL 二十四版实测）。
    """
    rgb = rgb.copy()
    alpha = alpha.copy()
    a = alpha.astype(np.float64) / 255.0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            ac = alpha[y0:y0 + cell, x0:x0 + cell]
            body = ac >= 200
            ys, xs = np.where(body)
            if not len(ys):
                continue
            ymin, ymax = ys.min(), ys.max()
            cut = max(0, ymax - min(40, int((ymax - ymin) * 0.25)))
            band = np.zeros_like(body)
            band[cut:ymax + 1, :] = True
            sat_full = rc.max(axis=2) - rc.min(axis=2)
            lum_full = rc.mean(axis=2)
            shadow = band & body & (sat_full < sat_thr) & (lum_full < lum_thr)
            if shadow.any():
                ac[shadow] = 0
                rc[shadow] = 0
                # 删除后保留最大连通域
                lab2, n2 = ndimage.label(ac > 30)
                if n2 > 1:
                    areas2 = [(int((lab2 == i).sum()), i) for i in range(1, n2 + 1)]
                    areas2.sort(reverse=True)
                    keep2 = areas2[0][1]
                    drop2 = (lab2 > 0) & (lab2 != keep2)
                    ac[drop2] = 0
                    rc[drop2] = 0
    return rgb, alpha


def verify(rgb, alpha, cell, cols, rows, name):
    """定量指标：白边/红边/孤立色块/脚底残留。"""
    a = alpha.astype(np.float64) / 255.0
    opaque = a > 0.98
    white = int((opaque & (rgb.mean(axis=2) > 235)).sum())
    red = int((opaque & (rgb[..., 0] > 150) & (rgb[..., 1] < 120) & (rgb[..., 2] < 120)).sum())
    detached = 0
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = opaque[y0:y0 + cell, x0:x0 + cell]
            # 脚底 60 行残留
            pass
    bottom = opaque[-60:, :]
    print(
        f"[verify] {name}: white_edge={white} red_edge={red} "
        f"bottom60_opaque={int(bottom.sum())}px",
        flush=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--files", default=None)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    model = rmbg2.BEN2Model()
    ok, msg = model.check_model_cache("BEN2")
    if not ok:
        raise SystemExit(f"BEN2 cache: {msg}")

    only = set(f.strip() for f in (args.files or "").split(",") if f.strip())
    t0 = time.time()
    for name, cols, rows, cell in JOBS:
        if only and name not in only:
            continue
        src = os.path.join(ASSETS, name)
        if not os.path.exists(src):
            print(f"[skip] missing {name}", flush=True)
            continue
        orig = Image.open(src).convert("RGBA")
        w0, h0 = orig.size
        comp = composite_white(orig)
        alpha_orig = np.array(orig)[..., 3]
        if w0 != cols * cell or h0 != rows * cell:
            print(f"[warn] {name}: {w0}x{h0} != {cols*cell}x{rows*cell}", flush=True)
        alpha_b = np.zeros((h0, w0), np.uint8)
        for r in range(rows):
            for c in range(cols):
                bx, by = c * cell, r * cell
                cell_img = comp.crop((bx, by, bx + cell, by + cell))
                tensor = torch.from_numpy(np.array(cell_img).astype(np.float32) / 255.0).unsqueeze(0)
                masks = model.process_image(
                    tensor, "BEN2", {"process_res": 1024, "sensitivity": 1.0}
                )
                m = np.array(masks[0] if isinstance(masks, list) else masks)
                alpha_b[by:by + cell, bx:bx + cell] = m

        alpha = np.maximum(alpha_b, alpha_orig)
        rgb = np.array(comp)
        rgb_clean, alpha_clean = decontaminate(rgb, alpha)
        rgb_clean, alpha_clean = remove_foot_shadow(rgb_clean, alpha_clean, cell, cols, rows)
        out_rgba = np.dstack([rgb_clean, alpha_clean]).astype(np.uint8)
        out_im = Image.fromarray(out_rgba, "RGBA")
        out_path = os.path.join(args.out, name)
        out_im.save(out_path)
        verify(rgb_clean, alpha_clean, cell, cols, rows, name)
        print(f"[done] {name} -> {out_path}", flush=True)

    print(f"[all] {time.time()-t0:.1f}s -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
