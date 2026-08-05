"""枪械图标硬筛：连通域唯一性 + 边缘半透白占比 + 主体覆盖率检查。

用法：python tools/ai-gen/_gun_filter.py <transparent_dir>
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def load_alpha(path):
    img = Image.open(path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    a = np.array(img)[:, :, 3]
    rgb = np.array(img)[:, :, :3]
    return a, rgb


def check(png_path):
    a, rgb = load_alpha(png_path)
    mask = a > 60
    labeled, n = ndimage.label(mask)
    # 连通域唯一
    ok_comp = n == 1
    # 边缘半透白占比（alpha in (60,240) 且 RGB 接近白）
    semi = (a > 60) & (a < 240)
    whitish = (rgb[:, :, 0] > 235) & (rgb[:, :, 1] > 235) & (rgb[:, :, 2] > 235)
    edge_white_ratio = float((semi & whitish).sum()) / max(1, int(mask.sum()))
    # 主体占比
    h, w = a.shape
    coverage = mask.sum() / (h * w)
    return {
        "components": int(n),
        "edge_white_ratio": edge_white_ratio,
        "coverage": coverage,
        "size": (w, h),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", help="透明 PNG 目录")
    args = ap.parse_args()

    raw_dir = args.dir
    files = sorted(f for f in os.listdir(raw_dir) if f.lower().endswith(".png"))
    passed, failed = [], []
    for f in files:
        src = os.path.join(raw_dir, f)
        info = check(src)
        flag = "PASS" if info["components"] == 1 and info["edge_white_ratio"] < 0.005 else "FAIL"
        print(f"{flag} {f} components={info['components']} edge_white={info['edge_white_ratio']:.4f} cov={info['coverage']:.3f}")
        (passed if flag == "PASS" else failed).append((f, info))
    print(f"SUMMARY pass={len(passed)} fail={len(failed)}")
    if failed:
        print("FAILED:", ", ".join(f[0] for f in failed))


if __name__ == "__main__":
    main()
