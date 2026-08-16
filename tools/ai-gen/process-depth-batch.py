#!/usr/bin/env python3
"""深度批组件库抠图入库（2026-08-04）。

把 gen-depth-test-assets.py 产出的白底原图抠成透明 PNG 入库
game-dev/assets/terrain/obstacle_<name>_<h|v>.png，并打印 footprint/obstacleH 供 ISO_WALL_GEO 注册。
用法：python tools/ai-gen/process-depth-batch.py [--keys scarecrow cottage]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

from PIL import Image
import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(DIR))  # game-dev
RAW = r"Y:\工作\无尽轮回\scratch\world122\depth-test\raw"
ASSETS = os.path.join(ROOT, "assets", "terrain")
PREP = os.path.join(DIR, "prep-obstacle.py")
COMFY_VENV_PY = os.path.join(os.path.dirname(ROOT), "ComfyUI", ".venv", "Scripts", "python.exe")

NAMES = [
    "farmland", "scarecrow", "haystack", "stump", "boulder", "fence",
    "woodpile", "barrel", "well", "tent", "campfire", "banner", "cart", "cottage",
]


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

    os.makedirs(ASSETS, exist_ok=True)
    prep_py = COMFY_VENV_PY if os.path.exists(COMFY_VENV_PY) else sys.executable
    geo = {}
    for name in NAMES:
        if args.keys and name not in args.keys:
            continue
        for orient in ("h", "v"):
            raw = os.path.join(RAW, f"{name}_{orient}.png")
            dst = os.path.join(ASSETS, f"obstacle_{name}_{orient}.png")
            if not os.path.exists(raw):
                print("SKIP missing", raw)
                continue
            if os.path.exists(dst):
                shutil.copy2(dst, dst + ".bak")
                print(f"   已备份旧文件 -> {os.path.basename(dst)}.bak")
            try:
                r = subprocess.run([prep_py, PREP, raw, dst], capture_output=True, text=True, timeout=300)
            except subprocess.TimeoutExpired:
                print(name, orient, "FAIL 抠图子进程超时（300s）")
                continue
            if r.returncode != 0:
                print(name, orient, "FAIL", (r.stderr or "")[-200:])
                continue
            w, h, fw, fd = measure(dst)
            geo[f"{name}_{orient}"] = {"tex": f"obstacle_{name}_{orient}", "w": w, "h": h, "foot": [fw, fd]}
            print(f"{name}_{orient}: {w}x{h} foot={fw}x{fd} -> {os.path.basename(dst)}")
    out = os.path.join(RAW, "_geo.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(geo, fh, ensure_ascii=False, indent=1)
    print("geo saved:", out)


if __name__ == "__main__":
    main()
