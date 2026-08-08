#!/usr/bin/env python3
"""单张怪物 idle 贴图预处理（2026-08-08，黑狼 idle 同规格）。

流程：白底候选图 → BiRefNet 抠图（ComfyUI-RMBG 节点）→ 归一化到 512×512
（内容高 262、脚底 410、水平居中）→ 硬边 245 + 最大连通域 + 边缘亮像素压暗
18 + 腿部区域去白 + 透明区 RGB 归零 → CLEAN 五指标验证。
用法（ComfyUI venv python）：
  python single-idle-prep.py --src <白底图.png> --out <512.png>
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image
import torch
from scipy import ndimage

COMFY_ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI"
sys.path.insert(0, COMFY_ROOT)
sys.path.insert(0, os.path.join(COMFY_ROOT, "custom_nodes", "ComfyUI-RMBG", "py"))

import folder_paths  # noqa: E402
import AILab_BiRefNet as rmbg  # noqa: E402

CELL = 512
TARGET_H = 262
FEET_Y = 410
CENTER_X = 256
HARD = 245
EDGE_DARK = 18


def birefnet_alpha(model, pil_rgb):
    arr = np.array(pil_rgb).astype(np.float32) / 255.0
    tensor = torch.from_numpy(arr).unsqueeze(0)  # BHWC
    mask = model.process_image(tensor, {"process_res": 1024})
    return np.array(mask)


def clean_cell(rgb, alpha):
    """单格清理（同 blackwolf post_clean）：硬二值化→最大连通域→边缘压暗→腿部去白→透明归零。"""
    h, w = alpha.shape
    a_bin = np.where(alpha >= HARD, 255, 0).astype(np.uint8)
    lab, n = ndimage.label(a_bin > 30)
    if n > 1:
        areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
        areas.sort(reverse=True)
        keep = areas[0][1]
        drop = (lab > 0) & (lab != keep)
        a_bin[drop] = 0
        rgb[drop] = 0
    opaque = a_bin >= 250
    bright = opaque & (rgb.mean(axis=2) > 150)
    trans = a_bin < 200
    near = ndimage.binary_dilation(trans, iterations=2)
    rgb[near & bright] = EDGE_DARK
    # 腿部区域（bbox 底部 35%）亮像素 -> 5x5 邻域毛色均值
    body = a_bin >= 200
    ys, xs = np.where(body)
    if len(ys):
        y0, y1 = ys.min(), ys.max()
        cut = max(0, y0 + int((y1 - y0) * 0.65))
        band = np.zeros_like(body)
        band[cut:y1 + 1, :] = True
        bright_leg = band & body & (rgb.mean(axis=2) > 160)
        if bright_leg.any():
            dark = body & (~bright_leg)
            cnt = ndimage.uniform_filter(dark.astype(np.float32), size=5) * 25.0
            mean = np.stack([
                ndimage.uniform_filter((rgb[..., i] * dark).astype(np.float32), size=5) * 25.0
                for i in range(3)
            ], axis=-1) / np.maximum(cnt[..., None], 1e-6)
            mean = np.clip(mean, 0, 255).astype(np.uint8)
            mean[cnt < 1] = EDGE_DARK
            rgb[bright_leg] = mean[bright_leg]
    rgb[a_bin < 8] = 0
    return rgb, a_bin


def verify(rgb, alpha, composite_bg=180):
    a = alpha.astype(np.float64) / 255.0
    out = rgb * a[..., None] + composite_bg * (1 - a[..., None])
    lum = out.mean(axis=2)
    edge_band = (a > 0.05) & (a < 0.98)
    residue = int((edge_band & (lum > composite_bg - 5)).sum())
    stray = 0
    lab, n = ndimage.label(alpha > 30)
    stray = max(0, n - 1)
    semi = int(((alpha > 8) & (alpha < HARD)).sum())
    trans_nonblack = int(((alpha < 8) & (rgb.mean(axis=2) > 8)).sum())
    opaque = alpha >= 250
    bright = opaque & (rgb.mean(axis=2) > 150)
    trans = alpha < 200
    near = ndimage.binary_dilation(trans, iterations=2)
    edge_bright = int((near & bright).sum())
    return dict(stray=stray, semi=semi, trans_nonblack=trans_nonblack,
                edge_bright=edge_bright, composite_residue=residue)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    model = rmbg.BiRefNetModel()
    ok, msg = model.check_model_cache("BiRefNet-general")
    if not ok:
        raise SystemExit(f"model cache: {msg}")
    model.load_model("BiRefNet-general")

    pil = Image.open(args.src).convert("RGB")
    alpha_b = birefnet_alpha(model, pil)
    rgb = np.array(pil)

    ys, xs = np.where(alpha_b > 30)
    if not len(xs):
        raise SystemExit("no subject found by BiRefNet")
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ch, cw = y1 - y0 + 1, x1 - x0 + 1
    scale = TARGET_H / max(1, ch)
    nh, nw = TARGET_H, max(1, round(cw * scale))
    crop_rgb = np.array(Image.fromarray(rgb[y0:y1 + 1, x0:x1 + 1]).resize((nw, nh), Image.LANCZOS))
    crop_a = np.array(Image.fromarray(alpha_b[y0:y1 + 1, x0:x1 + 1]).resize((nw, nh), Image.BICUBIC))

    cell = np.zeros((CELL, CELL, 4), np.uint8)
    ox = CENTER_X - nw // 2
    oy = FEET_Y - nh + 1
    if ox < 0 or oy < 0 or ox + nw > CELL or oy + nh > CELL:
        raise SystemExit(f"subject too large for 512 cell: {nw}x{nh} at {ox},{oy}")
    cell[oy:oy + nh, ox:ox + nw] = np.dstack([crop_rgb, crop_a])

    rgb_c, a_c = clean_cell(cell[..., :3], cell[..., 3])
    out = np.dstack([rgb_c, a_c]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(args.out)

    r = verify(rgb_c, a_c)
    ok = all(v == 0 for k, v in r.items())
    cov = 100 * (a_c > 0).mean()
    ys2, xs2 = np.where(a_c > 127)
    bh = (ys2.max() - ys2.min() + 1) if len(ys2) else 0
    print(f"{os.path.basename(args.src)} -> {os.path.basename(args.out)}: "
          f"cov={cov:.1f}% 主体高={bh} " + " ".join(f"{k}={v}" for k, v in r.items())
          + f" -> {'CLEAN' if ok else 'DIRTY!'}")


if __name__ == "__main__":
    main()
