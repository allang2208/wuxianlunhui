#!/usr/bin/env python3
"""等距树五变体抠图入库（2026-08-15）：raw 生图 → BiRefNet 抠图（进程内合成 RGBA）→
紧身裁剪 → 替换 assets/terrain/obstacle_tree_<name>.png（旧图备份 .bak-tree-20260815）→
打印 ISO_WALL_GEO 注册值（w/h/foot/obstacleH）。

⚠ 必须用 ComfyUI venv python 运行（rmbg_cutout 依赖 torch + ComfyUI-RMBG）：
    E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe \
        tools/ai-gen/process-tree-iso-assets.py [--keys tall wind]

坑（2026-08-15 实踩）：rmbg_cutout.py 的 CLI（--src/--out）只输出灰度 alpha 掩膜——
它是库入口；RGBA 合成必须像 rebuild-h3-birefnet.py 那样在进程内做。
ai-asset.py 的 cutout 子命令走该 CLI，不能直接用于入库（会把掩膜当成品）。

纪律：
- 抠图后检查底部不透明宽度（BiRefNet 吞站立底座的教训：树干底部必须保留）；
- 替换前旧图备份（保持可选回退）；
- obstacleH = round(内容高 × 0.317)（沿用旧五变体实测比例，世界尺寸保持一致）。
"""
import argparse
import os
import shutil
import sys

from PIL import Image
import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(DIR))  # game-dev
RAW = r"Y:\工作\无尽轮回\scratch\world122\tree-iso\raw"
ASSETS = os.path.join(ROOT, "assets", "terrain")
BAK = os.path.join(ASSETS, ".bak-tree-20260815")

NAMES = ["tall", "bushy", "twin", "wind", "tiered"]

# rmbg_cutout 位于同目录；import 需要 ComfyUI venv 环境（sys.path 在 rmbg_cutout 内部处理）
sys.path.insert(0, DIR)
import rmbg_cutout  # noqa: E402


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
    keys = args.keys or NAMES

    os.makedirs(BAK, exist_ok=True)
    model = rmbg_cutout.get_model()

    for k in keys:
        raw = os.path.join(RAW, f"tree_{k}.png")
        if not os.path.exists(raw):
            print(f"[skip] {k}: raw 不存在 {raw}")
            continue
        # 1. BiRefNet 抠图 + 进程内 RGBA 合成
        src = Image.open(raw).convert("RGB")
        alpha = rmbg_cutout.predict_alpha(model, src)
        rgba = np.dstack([np.array(src), alpha]).astype(np.uint8)
        im = Image.fromarray(rgba, "RGBA")
        # 2. 紧身裁剪
        im = crop_content(im)
        # 3. 底部保留检查（树干底座不能被吞）：底 5% 带不透明像素计数
        a = np.array(im)
        h, w = a.shape[:2]
        bottom = a[int(h * 0.95):, :, 3]
        bw = int((bottom > 8).sum())
        if bw < 30:
            print(f"[warn] {k}: 底部不透明像素过少（{bw}），BiRefNet 可能吞了树干底座，需人工复核")
        # 4. 备份旧图 + 覆盖入库
        dst = os.path.join(ASSETS, f"obstacle_tree_{k}.png")
        if os.path.exists(dst) and not os.path.exists(os.path.join(BAK, f"obstacle_tree_{k}.png")):
            shutil.copy2(dst, os.path.join(BAK, f"obstacle_tree_{k}.png"))
        im.save(dst)
        # 5. 测量 + 注册值
        cw, ch, foot_w, foot_d = measure(dst)
        print(f"[ok] {k}: {cw}x{ch} foot=({foot_w},{foot_d}) "
              f"-> w:{cw}, h:{ch}, foot:{{w:{foot_w},d:{foot_d}}}, obstacleH:{round(ch * 0.317)}")


if __name__ == "__main__":
    main()
