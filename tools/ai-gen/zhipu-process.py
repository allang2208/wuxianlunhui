#!/usr/bin/env python3
"""Process Zhipu outputs: locate watermark, patch it with white, BiRefNet cutout, normalize."""

import importlib.util
import os
import sys

import numpy as np
from PIL import Image

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

_spec = importlib.util.spec_from_file_location("bc", os.path.join(TOOLS, "birefnet-cutout.py"))
bc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bc)

_pie = importlib.util.spec_from_file_location("pie", os.path.join(TOOLS, "process-eclipse-icons.py"))
pie = importlib.util.module_from_spec(_pie)
_pie.loader.exec_module(pie)

RAW_DIR = os.path.join(TOOLS, "zhipu-raw")
TMP_DIR = os.path.join(TOOLS, "check-previews")
DST_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"

JOBS = {
    "xianzhe": "贤者项链.png",
    "fengling": "风灵项链.png",
    "xingyun_ring": "星陨之戒.png",
}


def find_watermark(rgb):
    """Watermark = small dark text block nearest the bottom-right corner."""
    h, w = rgb.shape[:2]
    # restrict to bottom-right corner band
    y0 = int(h * 0.80)
    x0 = int(w * 0.60)
    q = rgb[y0:, x0:]
    dark = q.mean(axis=2) < 170
    if dark.sum() == 0:
        return None
    from scipy import ndimage
    labels, n = ndimage.label(dark)
    best = None
    best_dist = 1e18
    for lab in range(1, n + 1):
        ys, xs = np.where(labels == lab)
        area = len(xs)
        if area > 800:  # too big = likely part of the item, skip
            continue
        # distance from corner
        dist = ((w - (x0 + xs.max())) ** 2 + (h - (y0 + ys.max())) ** 2) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max(), y0 + ys.max())
    return best


def patch_white(im, bbox, pad=12):
    """Fill bbox area with white (watermark on pure white bg)."""
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.size[0], x1 + pad)
    y1 = min(im.size[1], y1 + pad)
    patch = Image.new("RGB", (x1 - x0, y1 - y0), (255, 255, 255))
    im.paste(patch, (x0, y0))
    return im, (x0, y0, x1, y1)


def normalize(rgba):
    arr = np.asarray(rgba)
    alpha = arr[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError("empty")
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    crop = rgba.crop((x0, y0, x1, y1))
    w, h = crop.size
    sub_a = alpha[y0:y1, x0:x1].astype(np.float32)
    cyy, cxx = np.where(sub_a > 8)
    cx_rel = float(cxx.mean()) if len(cxx) else w / 2
    cy_rel = float(cyy.mean()) if len(cyy) else h / 2
    ar = w / h
    if ar > pie.MAX_AR:
        new_w = round(h * pie.MAX_AR)
        xc = int(min(max(cx_rel, new_w / 2), w - new_w / 2))
        crop = crop.crop((xc - new_w // 2, 0, xc + (new_w - new_w // 2), h))
    elif ar < pie.MIN_AR:
        new_h = round(w / pie.MIN_AR)
        yc = int(min(max(cy_rel, new_h / 2), h - new_h / 2))
        crop = crop.crop((0, yc - new_h // 2, w, yc + (new_h - new_h // 2)))
    cw, ch = crop.size
    scale = pie.TARGET / max(cw, ch)
    crop = crop.resize((max(1, round(cw * scale)), max(1, round(ch * scale))), Image.LANCZOS)
    arr2 = np.asarray(crop)
    a2 = arr2[..., 3]
    ys2, xs2 = np.where(a2 > 8)
    if len(xs2):
        crop = crop.crop((xs2.min(), ys2.min(), xs2.max() + 1, ys2.max() + 1))
    canvas = Image.new("RGBA", (pie.CANVAS, pie.CANVAS), (0, 0, 0, 0))
    pw, ph = crop.size
    canvas.paste(crop, ((pie.CANVAS - pw) // 2, (pie.CANVAS - ph) // 2), crop)
    return canvas


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="comma-separated keys; default all")
    args, _ = ap.parse_known_args()
    only = set(args.keys.split(",")) if args.keys else None

    model = bc.load_model()
    os.makedirs(DST_DIR, exist_ok=True)
    for key, dst_name in JOBS.items():
        if only is not None and key not in only:
            continue
        src = os.path.join(RAW_DIR, f"{key}.png")
        im = Image.open(src).convert("RGB")
        rgb = np.asarray(im).astype(np.int16)
        wm = find_watermark(rgb)
        print(f"{key}: watermark_bbox={wm}")
        if wm:
            im, bbox = patch_white(im, wm)
            print(f"  patched {bbox}")
        tmp = os.path.join(TMP_DIR, f"zhipu_{key}_patched.png")
        im.save(tmp)
        cut = os.path.join(TMP_DIR, f"zhipu_{key}_cut.png")
        rgba = bc.cutout(model, tmp, cut)
        final = normalize(rgba)
        out = os.path.join(DST_DIR, dst_name)
        final.save(out)
        print(f"saved {out} ({final.size[0]}x{final.size[1]})", flush=True)


if __name__ == "__main__":
    main()
