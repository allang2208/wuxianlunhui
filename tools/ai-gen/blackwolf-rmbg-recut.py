#!/usr/bin/env python3
"""黑狼精灵图 BiRefNet 重抠（ComfyUI-RMBG 方案，2026-08-07）。

输入：assets/enemies/black_wolf_*.png（已抠 RGBA，透明区 RGB 已归零）
流程：
  1) 现有 alpha 合成到白底 -> 得到"原始白底图"等价 RGB（还原真实边缘颜色）；
  2) 按 animation-config.json 的 frameLayout 切 512 格（updown 整图处理）；
  3) 每格过 ComfyUI-RMBG BiRefNet-general（1024 处理分辨率）-> alpha_b；
  4) alpha = max(alpha_b, 现有 alpha>=248 强制不透明)   # 保留主体，防 BiRefNet 丢腿；
  5) 去污（同 sprite-decontaminate 配方，bg=255）：
     半透反推前景色；反推后仍亮(>165)清半透；亮半透(lum>150 & alpha<245)清半透；
     不透明边缘亮像素压暗(edge_dark=18)；透明区 RGB 归零；
  6) 重组 sheet，定量验证 composite residue。

输出：tools/ai-gen/blackwolf-rmbg-out/black_wolf_*.png（同名，可直接覆盖替换）
      + compare_*.png（旧/新 棋盘格对比图）
用法（ComfyUI venv python）：
  python blackwolf-rmbg-recut.py [--threshold 248] [--lum-clear 150] [--edge-dark 18]
"""

import argparse
import os
import sys
import time

import numpy as np
from PIL import Image
import torch

COMFY_ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI"
ASSETS_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies"
OUT_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\blackwolf-rmbg-out"

sys.path.insert(0, COMFY_ROOT)
sys.path.insert(0, os.path.join(COMFY_ROOT, "custom_nodes", "ComfyUI-RMBG", "py"))

import folder_paths  # noqa: E402
import AILab_BiRefNet as rmbg  # noqa: E402

# (file, cols, rows, cell) — 512 格；None = 整图处理
JOBS = [
    ("black_wolf_idle.png", 1, 1, 512),
    ("black_wolf_walk.png", 4, 4, 512),
    ("black_wolf_run.png", 4, 7, 512),
    ("black_wolf_bite_regular.png", 3, 2, 512),
    ("black_wolf_pounce.png", 4, 5, 512),
    ("black_wolf_updown.png", None, None, None),
]


def composite_white(rgba):
    """RGBA -> 白底 RGB（还原生成时的白底素材）。"""
    a = np.array(rgba.convert("RGBA")).astype(np.float64)
    rgb = a[..., :3].copy()
    alpha = a[..., 3:4] / 255.0
    comp = rgb * alpha + 255.0 * (1 - alpha)
    return Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB")


def birefnet_alpha(model, pil_rgb):
    """BiRefNet alpha，返回与输入同尺寸的 0-255 单通道数组。"""
    arr = np.array(pil_rgb).astype(np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0)  # BHWC，ComfyUI 约定
    mask = model.process_image(tensor, {"process_res": 1024})
    return np.array(mask)


def decontaminate(rgb, alpha, bg=255, lum_clear=150, edge_dark=18):
    """去污：半透反推前景色、亮半透清零、边缘亮像素压暗、透明区 RGB 归零。"""
    rgb = rgb.astype(np.float64).copy()
    a = alpha.astype(np.float64) / 255.0
    h, w = rgb.shape[:2]

    semi = (a > 0.03) & (a < 0.98)
    if semi.any():
        inv = 1.0 - a[semi]
        f = (rgb[semi] - inv[:, None] * bg) / a[semi][:, None]
        rgb[semi] = np.clip(f, 0, 255)
        # 反推后仍亮 -> 未分离的残留 -> 清半透
        bright = rgb[semi].mean(axis=1) > 165
        drop_idx = np.where(semi)[0][bright]
        if len(drop_idx):
            a.flat[drop_idx] = 0
            rgb.reshape(-1, 3)[drop_idx] = 0

    # 亮半透（lum>lum_clear 且 alpha<250）直接清半透（黑狼白边核心；245~249 窄带也清）
    lum = rgb.mean(axis=2)
    light_semi = (lum > lum_clear) & (a > 0.03) & (a < 250 / 255.0)
    if light_semi.any():
        a[light_semi] = 0
        rgb[light_semi] = 0

    # 不透明边缘亮像素压暗
    opaque = a >= 0.98
    bright_px = opaque & (rgb.mean(axis=2) > 150)
    trans = a < 0.8
    big = trans.astype(np.uint8)
    near_trans = np.zeros((h, w), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near_trans |= (np.roll(np.roll(big, dy, axis=0), dx, axis=1) > 0)
    edge_bright = near_trans & bright_px
    rgb[edge_bright] = edge_dark

    # 透明区 RGB 归零
    rgb[a < 0.03] = 0
    return rgb.astype(np.uint8), (a * 255).astype(np.uint8)


def verify(rgb, alpha, composite_bg=180):
    """合成压测：边缘带亮度残留检查。"""
    a = alpha.astype(np.float64) / 255.0
    out = rgb * a[..., None] + composite_bg * (1 - a[..., None])
    lum = out.mean(axis=2)
    edge_band = (a > 0.05) & (a < 0.98)
    residue = int((edge_band & (lum > composite_bg - 5)).sum())
    return residue


def checker(old, new, cell=256):
    """棋盘格对比图。"""
    a = old.convert("RGBA"); b = new.convert("RGBA")
    w = max(a.width, b.width); h = max(a.height, b.height)
    board = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    px = board.load()
    for y in range(0, h, cell // 2):
        for x in range(0, w, cell // 2):
            if ((x // (cell // 2)) + (y // (cell // 2))) % 2:
                for yy in range(y, min(y + cell // 2, h)):
                    for xx in range(x, min(x + cell // 2, w)):
                        px[xx, yy] = (70, 70, 70, 255)
    la = Image.new("RGBA", (w, h), (0, 0, 0, 0)); la.paste(a, (0, 0))
    lb = Image.new("RGBA", (w, h), (0, 0, 0, 0)); lb.paste(b, (0, 0))
    side = Image.new("RGBA", (w * 2 + 8, h), (0, 0, 0, 255))
    side.paste(Image.alpha_composite(board, la), (0, 0))
    side.paste(Image.alpha_composite(board, lb), (w + 8, 0))
    return side


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=int, default=248, help="现有 alpha 强制主体阈值")
    ap.add_argument("--lum-clear", type=int, default=150, help="亮半透清零亮度上限")
    ap.add_argument("--edge-dark", type=int, default=18, help="边缘亮像素压暗色")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--files", default=None, help="只处理指定文件（逗号分隔，默认全部）")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    model = rmbg.BiRefNetModel()
    ok, msg = model.check_model_cache("BiRefNet-general")
    if not ok:
        raise SystemExit(f"model cache: {msg}")
    model.load_model("BiRefNet-general")
    print(f"[recut] model: {model.current_model_version} device={rmbg.device}", flush=True)

    total_t0 = time.time()
    only = set(f.strip() for f in (args.files or "").split(",") if f.strip())
    for name, cols, rows, cell in JOBS:
        if only and name not in only:
            continue
        src = os.path.join(ASSETS_DIR, name)
        if not os.path.exists(src):
            print(f"[recut] SKIP missing {name}", flush=True)
            continue
        t0 = time.time()
        orig = Image.open(src).convert("RGBA")
        w0, h0 = orig.size
        comp = composite_white(orig)
        alpha_orig = np.array(orig)[..., 3]

        if cols is None:
            alpha_b = birefnet_alpha(model, comp)
        else:
            if w0 != cols * cell or h0 != rows * cell:
                print(f"[recut] WARN {name}: size {w0}x{h0} != {cols*cell}x{rows*cell}", flush=True)
            alpha_b = np.zeros((h0, w0), np.uint8)
            for r in range(rows):
                for c in range(cols):
                    bx, by = c * cell, r * cell
                    cell_img = comp.crop((bx, by, bx + cell, by + cell))
                    alpha_b[by:by + cell, bx:bx + cell] = birefnet_alpha(model, cell_img)

        # 合并：max(BiRefNet, 现有主体阈值)
        alpha = np.maximum(alpha_b, (alpha_orig >= args.threshold).astype(np.uint8) * 255)
        rgb = np.array(comp)
        rgb_clean, alpha_clean = decontaminate(rgb, alpha, lum_clear=args.lum_clear, edge_dark=args.edge_dark)

        out_rgba = np.dstack([rgb_clean, alpha_clean]).astype(np.uint8)
        out_im = Image.fromarray(out_rgba, "RGBA")
        out_path = os.path.join(args.out, name)
        out_im.save(out_path)

        residue = verify(rgb_clean, alpha_clean)
        cov = 100 * (alpha_clean > 0).mean()
        semi = int(((alpha_clean > 0) & (alpha_clean < 250)).sum())
        print(f"[recut] {name}: cov={cov:.1f}% semi={semi} residue={residue}px "
              f"({time.time()-t0:.1f}s) -> {out_path}", flush=True)

        cmp = checker(orig, out_im)
        cmp.save(os.path.join(args.out, f"compare_{name}"))

    print(f"[recut] done in {time.time()-total_t0:.1f}s -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
