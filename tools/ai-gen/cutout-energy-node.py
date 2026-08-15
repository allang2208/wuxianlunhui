#!/usr/bin/env python3
"""能源矿/能源节点抠图 one-shot 包装器（2026-08-16）。

走 SKILL 规定的统一抠图入口：ComfyUI-RMBG 插件（BiRefNet-general，
`rmbg_cutout.py`），但补上 CLI 版缺少的「alpha 合成 RGBA + 紧身裁剪」，
避免把灰度掩膜当成品入库的坑。

必须用 ComfyUI venv python 运行：
    E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe ^
        tools\ai-gen\cutout-energy-node.py --src <原图.png> --out <透明成品.png>

说明：
- 只保留主体：BiRefNet 输出 alpha 后，默认只保留最大不透明连通域并裁剪透明边；
- 默认去污染：用图片边框环中位数估计背景色，按 alpha 反推前景色，减少背景泛色；
- 如主体确实包含多个独立碎片/飞屑，可用 --keep-all 关闭最大连通域过滤。
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except Exception:  # ComfyUI venv 不保证有 scipy，缺失时跳过最大连通域过滤
    ndimage = None

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


def estimate_background_rgb(rgb, margin=12):
    """用边框环中位数估计纯色背景；复杂背景时仅用于边缘去污染参考。"""
    ring = np.concatenate([
        rgb[:margin].reshape(-1, 3),
        rgb[-margin:].reshape(-1, 3),
        rgb[:, :margin].reshape(-1, 3),
        rgb[:, -margin:].reshape(-1, 3),
    ]).astype(np.float32)
    return np.median(ring, axis=0)


def cutout(src, dst, margin=2, min_alpha=8, keep_all=False):
    rgb_img = Image.open(src).convert("RGB")
    rgb = np.asarray(rgb_img).astype(np.float32)

    print(f"[cutout-energy-node] RMBG model loading for {src}", flush=True)
    alpha = predict_alpha(get_model(), rgb_img)
    a = np.asarray(alpha)
    if a.ndim == 3:
        a = a[..., 0]
    a = a.astype(np.float32) / 255.0
    print(f"[cutout-energy-node] alpha range: {float(a.min()):.2f}..{float(a.max()):.2f}",
          flush=True)

    # 只保留主体：最大不透明连通域（默认开，和图标/贴图入库口径一致）
    if not keep_all and ndimage is not None:
        mask = a > 0.5
        labels, n = ndimage.label(mask)
        if n:
            sizes = ndimage.sum(mask, labels, range(1, n + 1))
            keep = labels == (1 + int(np.argmax(sizes)))
            a = np.where(keep, a, 0.0)
    elif not keep_all:
        print("[cutout-energy-node] scipy not available, skip largest-component filter",
              flush=True)

    # 边缘去污染（背景泛色反推前景色；alpha 很低的像素保持原色）
    bg = estimate_background_rgb(rgb)
    aa = np.clip(a, 1e-3, 1.0)[..., None]
    fg = (rgb - (1.0 - aa) * bg) / aa
    fg = np.clip(fg, 0, 255)
    out_rgb = np.where(a[..., None] > 0.02, fg, rgb)

    out = np.dstack([out_rgb, (a * 255.0).astype(np.uint8)]).astype(np.uint8)

    # 紧身裁剪透明边
    ys, xs = np.where(a > (min_alpha / 255.0))
    if len(xs) == 0:
        print(f"[cutout-energy-node] no opaque content found in {src}", flush=True)
        out_img = Image.fromarray(out, "RGBA")
    else:
        x0 = max(0, int(xs.min()) - margin)
        y0 = max(0, int(ys.min()) - margin)
        x1 = min(out.shape[1], int(xs.max()) + 1 + margin)
        y1 = min(out.shape[0], int(ys.max()) + 1 + margin)
        out_img = Image.fromarray(out[y0:y1, x0:x1], "RGBA")

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    out_img.save(dst)
    opaque = float((a > 0.8).sum()) / a.size * 100
    print(f"[cutout-energy-node] saved {dst} size={out_img.size} "
          f"opaque%={opaque:.1f}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="原图（纯色底/复杂底均可）")
    ap.add_argument("--out", required=True, help="输出透明 RGBA PNG")
    ap.add_argument("--margin", type=int, default=2, help="裁剪透明边时保留的边距（像素）")
    ap.add_argument("--min-alpha", type=int, default=8, help="视为内容的最低 alpha（0-255）")
    ap.add_argument("--keep-all", action="store_true",
                    help="关闭最大连通域过滤（主体有多个独立碎片时使用）")
    args = ap.parse_args()
    cutout(args.src, args.out, margin=args.margin,
           min_alpha=args.min_alpha, keep_all=args.keep_all)


if __name__ == "__main__":
    main()
