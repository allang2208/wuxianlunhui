#!/usr/bin/env python3
"""GrabCut 前景 alpha 提取（OpenCV，需在装好 cv2 的 Python 里跑，通常走 ComfyUI .venv）。

适用于「背景非均匀」的纯色底失败场景（模型没按 hex 渲染，渐变/发光底）：
阈值与 BiRefNet 都会把背景残留成主体，而 GrabCut 用「边框必为背景 + 中心必为
主体」初始化，对渐变背景的颜色分布建模（GMM），能干净分离。

用法（供 tools/transparent_cutout.py 子进程调用，也可单独跑）：
    python grabcut-alpha.py --input raw.png --out alpha.npy

输出 float32 alpha（0~1，已羽化），npy 格式。
"""

import argparse
import os

import cv2
import numpy as np


def grabcut_alpha(path, iter_count=6, fg_seed="center"):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"cannot read image: {path}")
    h, w = img.shape[:2]

    def run(seed_mode):
        mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
        m = max(3, min(10, h // 64))
        mask[:m, :] = cv2.GC_BGD
        mask[-m:, :] = cv2.GC_BGD
        mask[:, :m] = cv2.GC_BGD
        mask[:, -m:] = cv2.GC_BGD
        cy, cx = h // 2, w // 2
        r = max(10, min(60, h // 10))
        if seed_mode == "center":
            mask[cy - r:cy + r, cx - r:cx + r] = cv2.GC_FGD
        else:  # quad：避开正中心（环形主体如盘绕腰带中心是空的）
            for oy, ox in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                mask[cy + oy * r // 2 - r // 2:cy + oy * r // 2 + r // 2,
                     cx + ox * r // 2 - r // 2:cx + ox * r // 2 + r // 2] = cv2.GC_FGD
        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        cv2.grabCut(img, mask, None, bgd, fgd, iter_count, cv2.GC_INIT_WITH_MASK)
        alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
                         1.0, 0.0).astype(np.float32)
        return cv2.GaussianBlur(alpha, (0, 0), 1.2)

    alpha = run(fg_seed)
    # center 种子结果异常（主体占比过小，多半中心其实是背景/环形主体）→ quad 重试
    if fg_seed == "center" and float((alpha > 0.8).sum()) / alpha.size < 0.08:
        alpha = run("quad")
    return alpha


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, help="输入 PNG（任意路径含中文均可）")
    ap.add_argument("--out", required=True, help="输出 alpha .npy")
    ap.add_argument("--iter", type=int, default=6)
    ap.add_argument("--fg-seed", default="center", choices=["center", "quad"],
                    help="前景种子：center 默认；环形主体用 quad")
    args = ap.parse_args()

    alpha = grabcut_alpha(args.input, iter_count=args.iter, fg_seed=args.fg_seed)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    np.save(args.out, alpha)
    print(f"grabcut alpha saved {args.out} (opaque%="
          f"{round(float((alpha > 0.8).sum()) / alpha.size * 100, 1)})", flush=True)


if __name__ == "__main__":
    main()
