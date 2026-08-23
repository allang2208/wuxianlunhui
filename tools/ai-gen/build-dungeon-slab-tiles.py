#!/usr/bin/env python3
"""Build large isometric dungeon-slab floor tiles from a seamless AI texture.

AI 只负责材质；本脚本拥有格网几何（沿用 build-building-road-tiles.py 的
逆等距映射思路）：把方形无缝纹理按逆等距映射采样进菱形帧，纹理中轴对齐的
石板缝在屏幕上严格平行于菱形边缘，斜率 = 帧高/帧宽（30° 用 0.5774）。

跨砖连续：变体相位按整砖周期（0.25 纹理单位）平移，砖缝位置不变，
只有砖面内部变化——多块随机混铺时砖缝依然全场连通。

用法：
  python tools/ai-gen/build-dungeon-slab-tiles.py <seamless.png> <out_dir> \
      --width 512 --slope 0.5774 --slabs 2 --variants 2 --prefix ruinslab30
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

SUPERSAMPLE = 4
SLAB_PERIOD = 0.25  # 无缝纹理中一块石板的周期（4×4 石板 / 1024px）


def bilinear_periodic(rgb, tx, ty):
    h, w = rgb.shape[:2]
    fx = np.mod(tx, 1.0) * w
    fy = np.mod(ty, 1.0) * h
    x0 = np.floor(fx).astype(np.int32) % w
    y0 = np.floor(fy).astype(np.int32) % h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    ax = (fx - np.floor(fx))[..., None]
    ay = (fy - np.floor(fy))[..., None]
    top = rgb[y0, x0] * (1.0 - ax) + rgb[y0, x1] * ax
    bottom = rgb[y1, x0] * (1.0 - ax) + rgb[y1, x1] * ax
    return top * (1.0 - ay) + bottom * ay


def make_tile(rgb, width, height, slabs, phase):
    sw, sh = width * SUPERSAMPLE, height * SUPERSAMPLE
    yy, xx = np.mgrid[0:sh, 0:sw]
    nx = (xx + 0.5 - sw / 2) / (sw / 2)
    ny = (yy + 0.5 - sh / 2) / (sh / 2)

    # 逆等距映射：菱形 → 单位方形，再按 slabs 块数缩放到纹理空间
    du = ((nx + ny) * 0.5 + 0.5) * slabs * SLAB_PERIOD + phase
    dv = ((ny - nx) * 0.5 + 0.5) * slabs * SLAB_PERIOD + phase

    # 边缘外扩 ~1.5px（最终分辨率），防止并排时露底色细缝
    eps = 3.0 / width
    d = np.abs(nx) + np.abs(ny)
    alpha = np.clip((1.0 + eps - d) / (2.0 * eps), 0.0, 1.0)

    sampled = bilinear_periodic(rgb, du, dv)
    rgba = np.zeros((sh, sw, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(sampled, 0, 255).astype(np.uint8)
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").resize(
        (width, height), Image.Resampling.LANCZOS
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="floor-asset.py 产出的无缝方形纹理")
    ap.add_argument("out_dir", help="输出目录")
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--slope", type=float, default=0.5774,
                    help="菱形边斜率：30°=0.5774，2:1=0.5")
    ap.add_argument("--slabs", type=int, default=2, help="每块地砖对角线上的石板数")
    ap.add_argument("--variants", type=int, default=2)
    ap.add_argument("--prefix", default="slabtile")
    args = ap.parse_args()

    height = int(round(args.width * args.slope))
    src = Image.open(args.src).convert("RGB")
    rgb = np.asarray(src, dtype=np.float32)

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(args.variants):
        tile = make_tile(rgb, args.width, height, args.slabs, i * SLAB_PERIOD)
        path = out / f"{args.prefix}-{i + 1}.png"
        tile.save(path, optimize=True)
        print(f"{path}: {tile.size}")


if __name__ == "__main__":
    main()
