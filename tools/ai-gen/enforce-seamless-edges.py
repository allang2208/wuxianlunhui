#!/usr/bin/env python3
"""让纹理四边严格周期连续，同时只在边缘带内渐进融合。

用法：
  python tools/ai-gen/enforce-seamless-edges.py input.png output.png --band 128
"""
import argparse

import numpy as np
from PIL import Image


def blend_opposite_edges(array, axis, band):
    size = array.shape[axis]
    band = max(2, min(int(band), size // 2))
    out = array.copy()
    for index in range(band):
        opposite = size - 1 - index
        strength = (1.0 - index / (band - 1)) ** 2
        left_slice = [slice(None)] * out.ndim
        right_slice = [slice(None)] * out.ndim
        left_slice[axis] = index
        right_slice[axis] = opposite
        left = out[tuple(left_slice)].copy()
        right = out[tuple(right_slice)].copy()
        average = (left + right) * 0.5
        out[tuple(left_slice)] = left * (1.0 - strength) + average * strength
        out[tuple(right_slice)] = right * (1.0 - strength) + average * strength
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--band", type=int, default=128)
    args = parser.parse_args()

    image = np.asarray(Image.open(args.src).convert("RGB"), dtype=np.float64)
    image = blend_opposite_edges(image, axis=1, band=args.band)
    image = blend_opposite_edges(image, axis=0, band=args.band)
    output = np.clip(image, 0, 255).astype(np.uint8)
    Image.fromarray(output).save(args.dst, optimize=True)

    horizontal = np.abs(output[:, 0].astype(int) - output[:, -1].astype(int)).mean()
    vertical = np.abs(output[0].astype(int) - output[-1].astype(int)).mean()
    horizontal_inner = np.abs(output[:, 1].astype(int) - output[:, -2].astype(int)).mean()
    vertical_inner = np.abs(output[1].astype(int) - output[-2].astype(int)).mean()
    print(
        f"{args.dst}: edge H={horizontal:.3f} V={vertical:.3f}; "
        f"inner H={horizontal_inner:.3f} V={vertical_inner:.3f}"
    )


if __name__ == "__main__":
    main()
