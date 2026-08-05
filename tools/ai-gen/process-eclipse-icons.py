#!/usr/bin/env python3
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

BASE = r"E:\无尽轮回\长期备份\2026-7-13-1"
SRC_DIR = os.path.join(BASE, "tools", "eclipse-raw")
DST_DIR = os.path.join(BASE, "game-dev", "assets", "icons", "equipment")

CANVAS = 1536
TARGET = CANVAS * 0.90
FEATHER = 1.0
MIN_AR = 0.72
MAX_AR = 1.40

NAMES = {
    "liuyun_helmet": "流云轻盔.png",
    "liuyun_armor": "流云轻甲.png",
    "liuyun_boots": "流云轻靴.png",
    "eclipse_helmet": "蚀月法帽.png",
    "eclipse_armor": "蚀月法袍.png",
    "eclipse_boots": "蚀月长靴.png",
    "zhenyue_helmet": "镇岳重盔.png",
    "zhenyue_armor": "镇岳重甲.png",
    "zhenyue_boots": "镇岳重靴.png",
    "xingyun_ring": "星陨之戒.png",
    "buxi_belt": "不息腰带.png",
    "panxin_necklace": "磐心项链.png",
}


def cutout(src):
    """Light-background cutout, vectorized, gradient-aware.

    SDXL "white background" renders are usually a light gray gradient with
    vignetting, so a fixed near-white threshold fails. We build a per-tile
    background color model from border samples (handles gradients), classify
    pixels by distance to their tile's background color, keep background
    components touching the border, then keep the largest foreground component
    and feather the alpha edge.
    """
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img).astype(np.float32)
    n, m, _ = rgb.shape

    # Per-tile background model from border bands.
    T = 8
    th, tw = n // T, m // T
    band = 12
    tile_bg = np.zeros((T, T, 3), dtype=np.float32)
    tile_ok = np.zeros((T, T), dtype=bool)
    border_mask = np.zeros((n, m), dtype=bool)
    border_mask[:band, :] = True
    border_mask[-band:, :] = True
    border_mask[:, :band] = True
    border_mask[:, -band:] = True
    for i in range(T):
        for j in range(T):
            y0, y1 = i * th, min((i + 1) * th, n)
            x0, x1 = j * tw, min((j + 1) * tw, m)
            seg = rgb[y0:y1, x0:x1][border_mask[y0:y1, x0:x1]]
            if len(seg) > 0:
                tile_bg[i, j] = np.median(seg, axis=0)
                tile_ok[i, j] = True

    # Propagate nearest known tile color (handles inner tiles / objects touching border).
    from scipy import ndimage as ndi
    idx = np.arange(T * T).reshape(T, T)
    dist, near = ndi.distance_transform_edt(~tile_ok, return_indices=True)
    near_i, near_j = near[0], near[1]
    filled = tile_bg[near_i, near_j]

    # Border samples for global tolerance (robust to small object bleed-in).
    border = rgb[border_mask]
    bg_med = np.median(border, axis=0)
    mad = np.median(np.abs(border - bg_med), axis=0)
    tol = float(max(40.0, mad.sum() * 3.0 + 10.0))

    # Distance to each pixel's tile background color.
    tile_img = filled[np.arange(n) // th][:, np.arange(m) // tw]
    dist_bg = np.abs(rgb - tile_img).sum(axis=2)
    near_bg = dist_bg <= tol

    labels, nlabels = ndimage.label(near_bg)
    bg_labels = set()
    border_px = (set(labels[0, :]) | set(labels[-1, :]) |
                 set(labels[:, 0]) | set(labels[:, -1]))
    for lab in border_px:
        if lab != 0:
            bg_labels.add(lab)
    background = np.zeros(near_bg.shape, dtype=bool)
    for lab in bg_labels:
        background |= labels == lab

    foreground = ~background
    flabels, nf = ndimage.label(foreground)
    if nf == 0:
        raise RuntimeError(f"{src}: no foreground found")
    sizes = ndimage.sum(foreground, flabels, range(1, nf + 1))
    keep = 1 + int(np.argmax(sizes))
    mask = flabels == keep
    mask = ndimage.binary_erosion(mask, iterations=2)

    alpha_f = ndimage.gaussian_filter(mask.astype(np.float32), sigma=FEATHER)
    alpha = np.clip(alpha_f * 255, 0, 255).astype(np.uint8)
    a_n = alpha_f[..., None].astype(np.float32)
    decont = (rgb - (1.0 - a_n) * tile_img) / np.maximum(a_n, 1e-3)
    decont = np.clip(decont, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([decont, alpha]).astype(np.uint8), "RGBA")


def normalize(rgba):
    arr = np.asarray(rgba)
    alpha = arr[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError("empty content")
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    crop = rgba.crop((x0, y0, x1, y1))
    w, h = crop.size

    # Alpha-weighted centroid inside the bbox (SKILL: aspect-ratio clamp window
    # is centered on the visual centroid, NOT the geometric center).
    sub_a = alpha[y0:y1, x0:x1].astype(np.float32)
    cyy, cxx = np.where(sub_a > 8)
    if len(cxx):
        cx_rel = float(cxx.mean())
        cy_rel = float(cyy.mean())
    else:
        cx_rel, cy_rel = w / 2, h / 2

    ar = w / h
    if ar > MAX_AR:
        new_w = round(h * MAX_AR)
        xc = int(min(max(cx_rel, new_w / 2), w - new_w / 2))
        crop = crop.crop((xc - new_w // 2, 0, xc + (new_w - new_w // 2), h))
    elif ar < MIN_AR:
        new_h = round(w / MIN_AR)
        yc = int(min(max(cy_rel, new_h / 2), h - new_h / 2))
        crop = crop.crop((0, yc - new_h // 2, w, yc + (new_h - new_h // 2)))

    cw, ch = crop.size
    scale = TARGET / max(cw, ch)
    crop = crop.resize((max(1, round(cw * scale)), max(1, round(ch * scale))), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    pw, ph = crop.size
    canvas.paste(crop, ((CANVAS - pw) // 2, (CANVAS - ph) // 2), crop)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="comma-separated keys to process; default all")
    args, _ = ap.parse_known_args()
    only = set(args.keys.split(",")) if args.keys else None

    os.makedirs(DST_DIR, exist_ok=True)
    for key, out_name in NAMES.items():
        if only is not None and key not in only:
            continue
        src = os.path.join(SRC_DIR, f"{key}.png")
        if not os.path.exists(src):
            print(f"SKIP {key}: missing")
            continue
        rgba = cutout(src)
        final = normalize(rgba)
        out = os.path.join(DST_DIR, out_name)
        final.save(out)
        print(f"saved {out} ({final.size[0]}x{final.size[1]})")


if __name__ == "__main__":
    main()
