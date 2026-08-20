#!/usr/bin/env python3
"""增强楼梯砖面的明暗分离，并用周期卷积锐化砖缝，不破坏无缝边界。"""
import argparse

import cv2
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--contrast", type=float, default=2.0)
    parser.add_argument("--lift", type=float, default=12.0)
    parser.add_argument("--sharpen", type=float, default=0.65)
    parser.add_argument("--sigma", type=float, default=1.0)
    args = parser.parse_args()

    image = np.asarray(Image.open(args.src).convert("RGB"), dtype=np.float32)
    mean = image.mean(axis=(0, 1), keepdims=True)
    contrast = np.clip(
        (image - mean) * args.contrast + mean + args.lift,
        0,
        255,
    )

    # 3×3周期平铺后做模糊，取中央块，避免普通卷积在四边制造新接缝。
    height, width = contrast.shape[:2]
    tiled = np.tile(contrast, (3, 3, 1))
    blurred = cv2.GaussianBlur(tiled, (0, 0), args.sigma)
    blurred = blurred[height:height * 2, width:width * 2]
    output = np.clip(
        contrast + (contrast - blurred) * args.sharpen,
        0,
        255,
    ).astype(np.uint8)
    Image.fromarray(output).save(args.dst, optimize=True)

    gray = cv2.cvtColor(output, cv2.COLOR_RGB2GRAY)
    seam_h = np.abs(output[:, 0].astype(int) - output[:, -1].astype(int)).mean()
    seam_v = np.abs(output[0].astype(int) - output[-1].astype(int)).mean()
    print(
        f"{args.dst}: mean={gray.mean():.1f} std={gray.std():.1f} "
        f"p5/p95={np.percentile(gray, [5, 95]).round(1).tolist()} "
        f"seam H/V={seam_h:.3f}/{seam_v:.3f}"
    )


if __name__ == "__main__":
    main()
