#!/usr/bin/env python3
"""写实高瘦树五变体抠图入库（2026-08-15 v2）：替换等距 v1（卡通风，用户验收画风不匹配退回）。
树种 → 键映射：poplar→tall / oak→bushy / birch→twin / dead→wind / pine→tiered。
当前 assets 里的等距 v1 备份到 .bak-tree-iso1-20260815（更早的正面平视旧版在 .bak-tree-20260815）。

⚠ 必须用 ComfyUI venv python 运行（进程内 BiRefNet 合成 RGBA）：
    E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe \
        tools/ai-gen/process-tree-iso2-assets.py [--keys poplar oak]
"""
import argparse
import os
import shutil
import sys

from PIL import Image
import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(DIR))
RAW = r"Y:\工作\无尽轮回\scratch\world122\tree-iso2\raw"
ASSETS = os.path.join(ROOT, "assets", "terrain")
BAK = os.path.join(ASSETS, ".bak-tree-iso1-20260815")

sys.path.insert(0, DIR)
import rmbg_cutout  # noqa: E402

# 树种 → 贴图键（obstacle_tree_<key>）
KEY_MAP = {"poplar": "tall", "oak": "bushy", "birch": "twin", "dead": "wind", "pine": "tiered"}


def crop_content(im, thresh=8):
    a = np.array(im)
    ys, xs = np.nonzero(a[:, :, 3] > thresh)
    return Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])


def measure(p):
    im = Image.open(p)
    a = np.array(im.split()[-1])
    h, w = a.shape
    band = a[int(h * 0.85):]
    colsum = (band > 128).sum(axis=0)
    solid = colsum > (band.shape[0] * 0.5)
    foot_w = int(np.count_nonzero(solid))
    foot_d = int(round(foot_w * 0.35))
    return w, h, foot_w, foot_d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="*", default=None)
    args = ap.parse_args()
    keys = args.keys or list(KEY_MAP.keys())

    os.makedirs(BAK, exist_ok=True)
    model = rmbg_cutout.get_model()

    for k in keys:
        raw = os.path.join(RAW, f"tree_{k}.png")
        if not os.path.exists(raw):
            print(f"[skip] {k}: raw 不存在 {raw}")
            continue
        src = Image.open(raw).convert("RGB")
        alpha = rmbg_cutout.predict_alpha(model, src)
        rgba = np.dstack([np.array(src), alpha]).astype(np.uint8)
        im = crop_content(Image.fromarray(rgba, "RGBA"))
        # 底部保留检查（树干底座不能被吞）
        a = np.array(im)
        h, w = a.shape[:2]
        bw = int((a[int(h * 0.95):, :, 3] > 8).sum())
        if bw < 30:
            print(f"[warn] {k}: 底部不透明像素过少（{bw}），需人工复核")
        key = KEY_MAP[k]
        dst = os.path.join(ASSETS, f"obstacle_tree_{key}.png")
        if os.path.exists(dst) and not os.path.exists(os.path.join(BAK, f"obstacle_tree_{key}.png")):
            shutil.copy2(dst, os.path.join(BAK, f"obstacle_tree_{key}.png"))
        im.save(dst)
        cw, ch, foot_w, foot_d = measure(dst)
        print(f"[ok] {k}->{key}: {cw}x{ch} foot=({foot_w},{foot_d}) "
              f"-> w:{cw}, h:{ch}, foot:{{w:{foot_w},d:{foot_d}}}, obstacleH:{round(ch * 0.317)}")


if __name__ == "__main__":
    main()
