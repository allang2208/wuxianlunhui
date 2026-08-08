#!/usr/bin/env python3
"""红狼/红狼王精灵图 BiRefNet 重抠（ComfyUI-RMBG 方案，2026-08-08）。

背景：用户反馈"脚步还有大量色块没抠图"。昨天黑狼已用 ComfyUI-RMBG 的
BiRefNet-general 节点重抠（blackwolf-rmbg-recut.py），本脚本是其红狼版：
  1) 现有 RGBA 合成白底 -> 还原白底素材 RGB；
  2) 按 animation-config 帧布局切格（pounce_bite 576²，其余 512²）；
  3) 每格过 ComfyUI-RMBG BiRefNet-general（1024 处理分辨率）-> alpha_b
     （显著性分割，能剔除脚底地面接触的黑块/白斑残留）；
  4) alpha = max(alpha_b, 现有 alpha>=248)   # 保留主体防丢腿；
  5) 去污（红毛版）：半透反推前景色、反推仍亮清半透、亮半透清零、
     不透明边缘亮像素压暗到红毛深色、透明区 RGB 归零；
  6) 重组 sheet，输出 composite residue 验证。

用法（ComfyUI venv python）：
  python rw-rmbg-recut.py [--out 输出目录] [--files a.png,b.png]
"""

import argparse
import os
import sys
import time

import numpy as np
from PIL import Image
import torch

COMFY_ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI"

sys.path.insert(0, COMFY_ROOT)
sys.path.insert(0, os.path.join(COMFY_ROOT, "custom_nodes", "ComfyUI-RMBG", "py"))

import folder_paths  # noqa: E402
import AILab_BiRefNet as rmbg  # noqa: E402

# (file, cols, rows, cell) —— pounce_bite 576²，其余 512²
JOBS = [
    ("red_wolf_king_idle.png", 1, 1, 512),
    ("red_wolf_king_run.png", 4, 4, 512),
    ("red_wolf_king_pacing.png", 4, 4, 512),
    ("red_wolf_king_pounce_claw.png", 4, 3, 512),
    ("red_wolf_king_pounce_bite.png", 4, 3, 576),
    ("red_wolf_king_change.png", 4, 3, 512),
    ("red_wolf_king_howl.png", 4, 3, 512),
    ("red_wolf_king_transformed_idle.png", 1, 1, 512),
    ("red_wolf_king_changed_run.png", 7, 2, 512),
    ("red_wolf_king_changed_attack.png", 4, 3, 512),
]

DARK_RED = (90, 18, 18)  # 红狼王深红毛兜底色


def composite_white(rgba):
    a = np.array(rgba.convert("RGBA")).astype(np.float64)
    rgb = a[..., :3].copy()
    alpha = a[..., 3:4] / 255.0
    comp = rgb * alpha + 255.0 * (1 - alpha)
    return Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB")


def birefnet_alpha(model, pil_rgb):
    arr = np.array(pil_rgb).astype(np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0)
    mask = model.process_image(tensor, {"process_res": 1024})
    return np.array(mask)


def decontaminate(rgb, alpha, bg=255, lum_clear=200, edge_dark=DARK_RED):
    rgb = rgb.astype(np.float64).copy()
    a = alpha.astype(np.float64) / 255.0

    semi = (a > 0.03) & (a < 0.98)
    if semi.any():
        inv = 1.0 - a[semi]
        f = (rgb[semi] - inv[:, None] * bg) / a[semi][:, None]
        rgb[semi] = np.clip(f, 0, 255)
        bright = rgb[semi].mean(axis=1) > 165
        drop_idx = np.where(semi)[0][bright]
        if len(drop_idx):
            a.flat[drop_idx] = 0
            rgb.reshape(-1, 3)[drop_idx] = 0

    lum = rgb.mean(axis=2)
    light_semi = (lum > lum_clear) & (a > 0.03) & (a < 250 / 255.0)
    if light_semi.any():
        a[light_semi] = 0
        rgb[light_semi] = 0

    # 边缘亮像素还原交给 rw-cutout-clean --soft（局部毛色 + 该格毛色中位数兜底）；
    # 这里不再压暗——固定 DARK_RED 会在脚底形成一圈深色描边 + 棋盘锯齿（红狼观感差）

    rgb[a < 0.03] = 0
    return rgb.astype(np.uint8), (a * 255).astype(np.uint8)


def verify(rgb, alpha, composite_bg=180):
    a = alpha.astype(np.float64) / 255.0
    out = rgb * a[..., None] + composite_bg * (1 - a[..., None])
    lum = out.mean(axis=2)
    edge_band = (a > 0.05) & (a < 0.98)
    return int((edge_band & (lum > composite_bg - 5)).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=int, default=248)
    ap.add_argument("--lum-clear", type=int, default=200)
    ap.add_argument("--out", default=r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\rw-rmbg-out")
    ap.add_argument("--files", default=None)
    args = ap.parse_args()

    assets = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "enemies"))
    os.makedirs(args.out, exist_ok=True)

    model = rmbg.BiRefNetModel()
    ok, msg = model.check_model_cache("BiRefNet-general")
    if not ok:
        raise SystemExit(f"model cache: {msg}")
    model.load_model("BiRefNet-general")
    print(f"[rw-recut] model: {model.current_model_version} device={rmbg.device}", flush=True)

    only = set(f.strip() for f in (args.files or "").split(",") if f.strip())
    t0 = time.time()
    for name, cols, rows, cell in JOBS:
        if only and name not in only:
            continue
        src = os.path.join(assets, name)
        if not os.path.exists(src):
            print(f"[rw-recut] SKIP missing {name}", flush=True)
            continue
        orig = Image.open(src).convert("RGBA")
        w0, h0 = orig.size
        comp = composite_white(orig)
        alpha_orig = np.array(orig)[..., 3]
        if w0 != cols * cell or h0 != rows * cell:
            print(f"[rw-recut] WARN {name}: {w0}x{h0} != {cols*cell}x{rows*cell}", flush=True)
        alpha_b = np.zeros((h0, w0), np.uint8)
        for r in range(rows):
            for c in range(cols):
                bx, by = c * cell, r * cell
                cell_img = comp.crop((bx, by, bx + cell, by + cell))
                alpha_b[by:by + cell, bx:bx + cell] = birefnet_alpha(model, cell_img)

        # 红狼王软边 alpha（30~247）也是有效主体，必须保留（黑狼硬边才只留 >=248）
        alpha = np.maximum(alpha_b, alpha_orig)
        rgb = np.array(comp)
        rgb_clean, alpha_clean = decontaminate(rgb, alpha, lum_clear=args.lum_clear)
        out_rgba = np.dstack([rgb_clean, alpha_clean]).astype(np.uint8)
        out_im = Image.fromarray(out_rgba, "RGBA")
        out_path = os.path.join(args.out, name)
        out_im.save(out_path)
        residue = verify(rgb_clean, alpha_clean)
        semi = int(((alpha_clean > 0) & (alpha_clean < 250)).sum())
        print(f"[rw-recut] {name}: semi={semi} residue={residue}px -> {out_path}", flush=True)

    print(f"[rw-recut] done in {time.time()-t0:.1f}s -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
