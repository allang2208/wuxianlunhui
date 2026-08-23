# -*- coding: utf-8 -*-
"""冰封地牢直墙入库：镜像统一方向、紧裁透明画布并输出几何标定值。"""

from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "ai-gen" / "_frozen_dungeon_20260822" / "ice_wall_raw.png"
DST = ROOT / "assets" / "terrain" / "frozen_wall_straight.png"


def main():
    image = Image.open(SRC).convert("RGBA")
    pixels = np.asarray(image)[:, ::-1, :].copy()
    ys, xs = np.nonzero(pixels[:, :, 3] > 8)
    if len(xs) == 0:
        raise RuntimeError(f"冰墙渲染没有有效 alpha：{SRC}")

    cropped = Image.fromarray(pixels).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    cropped.save(DST)

    alpha = np.asarray(cropped)[:, :, 3]
    height, width = alpha.shape
    bottom = np.full(width, -1.0)
    top = np.full(width, -1.0)
    for x in range(width):
        column = np.nonzero(alpha[:, x] > 20)[0]
        if len(column):
            top[x], bottom[x] = column.min(), column.max()

    valid = np.nonzero(bottom >= 0)[0]
    face_x = valid[(valid >= width * 0.12) & (valid <= width * 0.88)]
    slope, intercept = np.polyfit(face_x, bottom[face_x], 1)
    residual = np.abs(bottom[face_x] - (slope * face_x + intercept))
    middle = valid[(valid >= width * 0.25) & (valid <= width * 0.75)]
    wall_height = float(np.median(bottom[middle] - top[middle]))
    face = [
        [int(face_x.min()), int(round(intercept + slope * face_x.min()))],
        [int(face_x.max()), int(round(intercept + slope * face_x.max()))],
    ]
    base = [
        [0, int(round(intercept))],
        [width - 1, int(round(intercept + slope * (width - 1)))],
    ]

    print(f"saved {DST} {width}x{height}")
    print(f"slope={slope:.4f} residual_max={residual.max():.1f}")
    print(f"base={base}")
    print(f"face={face}")
    print(f"wallH={wall_height:.1f}")


if __name__ == "__main__":
    main()
