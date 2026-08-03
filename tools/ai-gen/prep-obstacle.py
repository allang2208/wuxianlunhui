# -*- coding: utf-8 -*-
"""障碍物素材抠图入库（等距版，2026-08-03）。

白底 AI 出图 → GrabCut（边界环=背景、中央=前景）→ 背景色过滤（亮灰残留剔除，
保留暗阴影）→ 最大连通域 → 边缘去污染 → 包围盒紧身裁剪 → assets/terrain/obstacle_*.png。

用法：
    python tools/ai-gen/prep-obstacle.py <raw.png> <out.png> [--center 0.25,0.25,0.75,0.75]
"""
import argparse
import sys

import cv2
import numpy as np
from PIL import Image


def corner_mean(img):
    h, w = img.shape[:2]
    b = 16
    patches = [img[0:b, 0:b], img[0:b, w - b:], img[h - b:, 0:b], img[h - b:, w - b:]]
    return np.concatenate([p.reshape(-1, 3) for p in patches]).mean(axis=0)


def grabcut_mask(img, center=(0.25, 0.25, 0.75, 0.75), border=30):
    h, w = img.shape[:2]
    gcm = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    gcm[:border, :] = cv2.GC_BGD
    gcm[-border:, :] = cv2.GC_BGD
    gcm[:, :border] = cv2.GC_BGD
    gcm[:, -border:] = cv2.GC_BGD
    cx0, cy0, cx1, cy1 = (int(v * s) for v, s in zip(center, (w, h, w, h)))
    gcm[cy0:cy1, cx0:cx1] = cv2.GC_FGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), gcm, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
    mask = ((gcm == cv2.GC_FGD) | (gcm == cv2.GC_PR_FGD)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    # 背景色过滤：亮灰残留（接近白底/间隙背景）剔除，暗阴影保留
    bg_model = corner_mean(img)
    bg_lum = 0.299 * bg_model[0] + 0.587 * bg_model[1] + 0.114 * bg_model[2]
    rgb = img.astype(int)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    bg_like = (sat < 0.08) & (lum > bg_lum - 70) & (lum < bg_lum + 60)
    mask[bg_like] = 0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = 1 + int(np.argmax(areas))
        mask = (labels == keep).astype(np.uint8)
    return mask


def decontaminate(rgb, mask, feather=1):
    """边缘去污染：1px 羽化 + 半透明边缘 RGB 反推为邻近前景色（去灰边）。"""
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
    alpha = np.clip(255 * (dist - 0.5), 0, 255).astype(np.uint8)
    core = (alpha >= 250)
    ys, xs = np.nonzero((alpha > 0) & (alpha < 250))
    if len(xs) == 0:
        return alpha, 0.0, rgb
    edges = np.stack([ys, xs], axis=1)
    for y, x in edges:
        patch = core[max(0, y - feather):y + feather + 1, max(0, x - feather):x + feather + 1]
        if patch.sum() == 0:
            continue
        py, px = np.nonzero(patch)
        cy = max(0, y - feather) + py
        cx = max(0, x - feather) + px
        rgb[y, x] = np.median(rgb[cy, cx], axis=0)
    edge_rgb = rgb[edges[:, 0], edges[:, 1]].astype(int)
    mx = edge_rgb.max(axis=1)
    mn = edge_rgb.min(axis=1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    gray_ratio = float((sat < 0.06).mean())
    return alpha, gray_ratio, rgb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--center", default="0.25,0.25,0.75,0.75")
    ap.add_argument("--margin", type=int, default=2)
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGB")
    rgb = np.array(im).astype(np.uint8)
    h, w = rgb.shape[:2]
    center = tuple(float(v) for v in args.center.split(","))

    mask = grabcut_mask(rgb, center)
    alpha, gray_ratio, rgb = decontaminate(rgb.copy(), mask)
    rgba = np.dstack([rgb, alpha])
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        print(f"{args.src}: EMPTY mask", file=sys.stderr)
        sys.exit(1)
    x0, x1 = max(0, xs.min() - args.margin), min(w, xs.max() + 1 + args.margin)
    y0, y1 = max(0, ys.min() - args.margin), min(h, ys.max() + 1 + args.margin)
    crop = rgba[y0:y1, x0:x1]
    Image.fromarray(crop).save(args.out, optimize=True)

    bw, bh = x1 - x0, y1 - y0
    band = alpha[y0 + int(bh * 0.85):y1]
    colsum = (band > 128).sum(axis=0)
    solid = colsum > (band.shape[0] * 0.5)
    foot_w = int(np.count_nonzero(solid))
    foot_d = int(round(foot_w * 0.35))
    print(f"{args.src} -> {args.out}")
    print(f"  size {bw}x{bh}  aspect={bw / bh:.3f}  fg={(alpha > 128).mean() * 100:.1f}%")
    print(f"  gray-edge-ratio={gray_ratio * 100:.2f}% (应 <5%)")
    print(f"  footprint w={foot_w} d={foot_d}  obstacleH建议={int(round(bh * 0.18))}")


if __name__ == "__main__":
    main()
