#!/usr/bin/env python3
"""Full icon pipeline: BiRefNet transparent cutout -> 1536x1536 normalized.

Replaces the fragile border flood-fill cutout with BiRefNet (saliency-based),
then applies the SKILL.md icon normalization (bbox 90%, aspect [0.72,1.4],
centroid-clamped aspect crop, center on 1536x1536 transparent canvas).
"""

import argparse
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

_spec = importlib.util.spec_from_file_location(
    "birefnet_cutout", os.path.join(TOOLS, "birefnet-cutout.py"))
birefnet_cutout = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(birefnet_cutout)

_pie = importlib.util.spec_from_file_location(
    "process_eclipse_icons", os.path.join(TOOLS, "process-eclipse-icons.py"))
pie = importlib.util.module_from_spec(_pie)
_pie.loader.exec_module(pie)
CANVAS, TARGET, MIN_AR, MAX_AR = pie.CANVAS, pie.TARGET, pie.MIN_AR, pie.MAX_AR

RAW_DIR = os.path.join(TOOLS, "eclipse-raw")
DST_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\equipment"

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


def normalize(rgba):
    arr = np.asarray(rgba)
    alpha = arr[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError("empty content after cutout")
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    crop = rgba.crop((x0, y0, x1, y1))
    w, h = crop.size

    sub_a = alpha[y0:y1, x0:x1].astype(np.float32)
    cyy, cxx = np.where(sub_a > 8)
    cx_rel = float(cxx.mean()) if len(cxx) else w / 2
    cy_rel = float(cyy.mean()) if len(cyy) else h / 2

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

    # Re-center on the actual content bbox (aspect clamp may leave content
    # off-center inside the crop window).
    arr = np.asarray(crop)
    a = arr[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs):
        x0, x1 = xs.min(), xs.max() + 1
        y0, y1 = ys.min(), ys.max() + 1
        crop = crop.crop((x0, y0, x1, y1))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    pw, ph = crop.size
    canvas.paste(crop, ((CANVAS - pw) // 2, (CANVAS - ph) // 2), crop)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="comma-separated keys; default all")
    args, _ = ap.parse_known_args()
    only = set(args.keys.split(",")) if args.keys else None

    model = birefnet_cutout.load_model()
    print(f"BiRefNet loaded ({birefnet_cutout.device})", flush=True)
    os.makedirs(DST_DIR, exist_ok=True)
    for key, out_name in NAMES.items():
        if only is not None and key not in only:
            continue
        src = os.path.join(RAW_DIR, f"{key}.png")
        if not os.path.exists(src):
            print(f"SKIP {key}: missing raw")
            continue
        rgba = birefnet_cutout.cutout(model, src, os.path.join(
            TOOLS, "check-previews", f"{key}_birefnet.png"))
        final = normalize(rgba)
        out = os.path.join(DST_DIR, out_name)
        final.save(out)
        print(f"saved {out} ({final.size[0]}x{final.size[1]})", flush=True)


if __name__ == "__main__":
    main()
