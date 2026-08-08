#!/usr/bin/env python3
"""红狼人 idle 单帧裁剪（2026-08-08，方案 A 统一体型）。
用统一参考图（rwk_tatk_f10 → rw-humanoid-ref-1024.png）裁出 512² 静态帧，
复用 BiRefNet 管线：alpha=max(BiRefNet, 深色阈值248) → uniform-h 262 →
feet-y 410 摆放 → 逐格清理（硬边245/最大连通域/边缘局部毛色/透明归零/腿部去残留）。
"""
import argparse
import os

import numpy as np
from PIL import Image
import cv2
import torch
from scipy import ndimage

MODEL_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\models\BiRefNet\MS-BiRefNet"
DARK_RED = (90, 18, 18)


def load_model():
    from transformers import AutoModelForImageSegmentation
    model = AutoModelForImageSegmentation.from_pretrained(
        MODEL_DIR, trust_remote_code=True, local_files_only=True
    )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()
    if device == "cuda":
        model.half()
    print(f"[birefnet] model on {device}", flush=True)
    return model, device


def predict_alpha(model, device, pil):
    from torchvision import transforms
    tf = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.5, 0.5, 0.5], [1.0, 1.0, 1.0]),
    ])
    inp = tf(pil).unsqueeze(0).to(device)
    if device == "cuda":
        inp = inp.half()
    with torch.no_grad():
        preds = model(inp)[-1].sigmoid().cpu()
    pred = preds[0].squeeze()
    alpha = (pred.numpy() * 255).astype(np.uint8)
    return cv2.resize(alpha, (pil.width, pil.height), interpolation=cv2.INTER_LINEAR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target-h", type=int, default=262)
    ap.add_argument("--feet-y", type=int, default=410)
    ap.add_argument("--center-x", type=int, default=256)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--threshold", type=int, default=248)
    ap.add_argument("--fixed-scale", action="store_true",
                    help="用首帧同比例缩放（uniform-h 会把矮帧放大导致宽度暴涨，红狼王用 fixed-scale）")
    args = ap.parse_args()

    pil = Image.open(args.src).convert("RGB")
    rgb = np.array(pil)
    model, device = load_model()
    alpha_b = predict_alpha(model, device, pil)
    gray = np.array(pil.convert("L"))
    alpha_thr = (gray <= args.threshold).astype(np.uint8) * 255
    alpha = np.maximum(alpha_b, alpha_thr).astype(np.uint8)
    # 去污染：亮半透清零
    lum = rgb.astype(int).mean(axis=2)
    light_semi = (lum > 200) & (alpha < 250)
    alpha[light_semi] = 0
    bbox_mask = alpha > 30
    ys, xs = np.where(bbox_mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ch = y1 - y0 + 1
    cw = x1 - x0 + 1
    if args.fixed_scale:
        scale = args.target_h / max(1, ch)
        nh = max(1, round(ch * scale))
    else:
        scale = args.target_h / max(1, ch)
        nh = args.target_h
    nw = max(1, round(cw * scale))
    crop = cv2.resize(rgb[y0:y1 + 1, x0:x1 + 1], (nw, nh), interpolation=cv2.INTER_AREA)
    a = cv2.resize(alpha[y0:y1 + 1, x0:x1 + 1], (nw, nh), interpolation=cv2.INTER_AREA)
    cell = np.zeros((args.cell, args.cell, 4), np.uint8)
    ox = args.center_x - nw // 2
    oy = args.feet_y - nh + 1
    if ox < 0 or ox + nw > args.cell or oy < 0 or oy + nh > args.cell:
        raise RuntimeError(f"content {nw}x{nh} at ({ox},{oy}) exceeds cell {args.cell}")
    cell[oy:oy + nh, ox:ox + nw] = np.dstack([crop, a])
    # 逐格清理（黑狼 CLEAN 铁律）
    rc = cell[..., :3].astype(np.float64)
    ac = cell[..., 3].astype(np.float64)
    a_bin = np.where(ac >= 245, 255, 0).astype(np.uint8)
    lab, n = ndimage.label(a_bin > 30)
    if n > 1:
        areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
        areas.sort(reverse=True)
        keep = areas[0][1]
        drop = (lab > 0) & (lab != keep)
        a_bin[drop] = 0
        rc[drop] = 0
    opaque = a_bin >= 250
    bright = opaque & (rc.mean(axis=2) > 150)
    trans = a_bin < 200
    near = ndimage.binary_dilation(trans, iterations=2)
    dark = opaque & (~bright)
    cnt = ndimage.uniform_filter(dark.astype(np.float32), size=5) * 25.0
    mean = np.stack([
        ndimage.uniform_filter((rc[..., i] * dark).astype(np.float32), size=5) * 25.0
        for i in range(3)
    ], axis=-1) / np.maximum(cnt[..., None], 1e-6)
    mean = np.clip(mean, 0, 255).astype(np.uint8)
    mean[cnt < 1] = DARK_RED
    rc[near & bright] = mean[near & bright]
    rc[a_bin < 8] = 0
    body = a_bin >= 200
    ys2, xs2 = np.where(body)
    if len(ys2):
        ymin, ymax = ys2.min(), ys2.max()
        cut = max(0, ymin + int((ymax - ymin) * 0.65))
        band = np.zeros_like(body)
        band[cut:ymax + 1, :] = True
        bright_leg = band & body & (rc.mean(axis=2) > 160)
        if bright_leg.any():
            dark2 = body & (~bright_leg)
            cnt2 = ndimage.uniform_filter(dark2.astype(np.float32), size=5) * 25.0
            mean2 = np.stack([
                ndimage.uniform_filter((rc[..., i] * dark2).astype(np.float32), size=5) * 25.0
                for i in range(3)
            ], axis=-1) / np.maximum(cnt2[..., None], 1e-6)
            mean2 = np.clip(mean2, 0, 255).astype(np.uint8)
            mean2[cnt2 < 1] = DARK_RED
            rc[bright_leg] = mean2[bright_leg]
    ac[...] = a_bin
    out = np.dstack([rc, ac]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(args.out)
    content = (ac > 30)
    y3, x3 = np.where(content)
    print(f"[idle-cut] sheet {out.shape} -> {args.out} content {x3.max()-x3.min()+1}x{y3.max()-y3.min()+1}")


if __name__ == "__main__":
    main()
