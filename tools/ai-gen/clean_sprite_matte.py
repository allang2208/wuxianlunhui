#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
clean_sprite_matte.py — 精灵图抠图残留清理（黑狼/红狼类"脏色块"救治）

针对白底生成+抠图管线的三种典型残留：
1. 轮廓光晕环：紧贴剪影外圈的中性灰像素（白底混色），alpha 已是二值、RGB 脏了
   → 逐圈剥除"亮度 > halo-lum 且低饱和"的边缘环像素（默认 2 圈）
2. 地面阴影条：与主体连通域粘连的扁宽实心横条
   → 逐组件自底向上检测"单段连续宽度 > strip-w-ratio × 组件宽"的行，整行剥除
3. 碎屑小块：剥除后脱落的小连通域 → 面积 < min-blob 直接删

可选 defringe：剥除后把新边缘像素的 RGB 用内侧 1px 实体色外渗（防硬边色偏）

用法：
  python clean_sprite_matte.py in.png out.png [--halo-lum 120] [--halo-passes 2]
      [--strip-w-ratio 0.55] [--strip-max-rows 16] [--min-blob 3000] [--defringe]
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage


def remove_halo(alpha, rgb, lum_th, passes, sat_th=40):
    """逐圈剥除边缘亮灰环。返回新 mask。低饱和 = max(R,G,B)-min(R,G,B) < sat_th。"""
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    for _ in range(passes):
        er = ndimage.binary_erosion(alpha, border_value=0)
        ring = alpha & ~er
        kill = ring & (lum > lum_th) & (sat < sat_th)
        if not kill.any():
            break
        alpha = alpha & ~kill
    return alpha


def remove_speckle(alpha, size=3, iterations=2):
    """形态学开运算（腐蚀→膨胀）：抖动阴影/飞溅碎点没有实心核，腐蚀后即消失，
    膨胀恢复实心主体形状。毛尖 1px 细丝会被收掉（像素精灵下通常更干净）。"""
    st = np.ones((size, size), dtype=bool)
    return ndimage.binary_opening(alpha, structure=st, iterations=iterations)


def remove_ground_strips(alpha, w_ratio, max_rows):
    """逐连通域剥除底部扁宽实心横条（地面阴影）。"""
    lab, n = ndimage.label(alpha)
    out = alpha.copy()
    for i in range(1, n + 1):
        comp = lab == i
        ys, xs = np.where(comp)
        if len(ys) == 0:
            continue
        y_max, y_min = ys.max(), ys.min()
        comp_w = xs.max() - xs.min() + 1
        # 底部窗口内逐行判定：最长连续段超宽即剥（不限于贴底行——条下方常挂细碎行，
        # 自底向上遇窄即停会被碎行挡住）。狼体正常行不可能有近满宽单段实心，安全。
        for y in range(y_max, max(y_min, y_max - max_rows) - 1, -1):
            row = comp[y]
            if not row.any():
                continue
            # 该行最长连续段
            runs = np.diff(np.flatnonzero(np.concatenate(([False], row, [False]))))
            max_run = runs[1::2].max() if len(runs) >= 2 else 0
            if max_run > comp_w * w_ratio:
                out[y] &= ~comp[y]
    return out


def remove_small_blobs(alpha, min_blob):
    lab, n = ndimage.label(alpha)
    if n == 0:
        return alpha
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= min_blob
    return keep[lab]


def defringe(alpha, rgb):
    """边缘 1px 像素的 RGB 用内侧最近实体像素颜色替换（去白/绿溢色）。"""
    er = ndimage.binary_erosion(alpha, border_value=0)
    edge = alpha & ~er
    if not edge.any():
        return rgb
    # distance_transform_edt 的 return_indices：每个像素最近的"零值"（这里取反：内部为 0）
    inner = er
    _, ind = ndimage.distance_transform_edt(~inner, return_indices=True)
    out = rgb.copy()
    out[edge] = rgb[ind[0][edge], ind[1][edge]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('output')
    ap.add_argument('--halo-lum', type=float, default=120)
    ap.add_argument('--halo-passes', type=int, default=2)
    ap.add_argument('--strip-w-ratio', type=float, default=0.55)
    ap.add_argument('--strip-max-rows', type=int, default=16)
    ap.add_argument('--min-blob', type=float, default=3000)
    ap.add_argument('--open-iters', type=int, default=2,
                    help='形态学开运算迭代次数（杀抖动阴影/碎点）；0=关闭')
    ap.add_argument('--defringe', action='store_true')
    args = ap.parse_args()

    im = Image.open(args.input).convert('RGBA')
    a = np.array(im)
    rgb = a[..., :3].astype(np.float64)
    alpha = a[..., 3] > 0
    before = int(alpha.sum())

    alpha = remove_halo(alpha, rgb, args.halo_lum, args.halo_passes)
    if args.open_iters > 0:
        alpha = remove_speckle(alpha, iterations=args.open_iters)
    alpha = remove_ground_strips(alpha, args.strip_w_ratio, args.strip_max_rows)
    alpha = remove_small_blobs(alpha, args.min_blob)
    if args.defringe:
        rgb = defringe(alpha, rgb)
    after = int(alpha.sum())

    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8),
                     (alpha * 255).astype(np.uint8)])
    Image.fromarray(out, 'RGBA').save(args.output)
    print(f'{args.input} -> {args.output}: opaque {before} -> {after} '
          f'(-{before - after}, -{(before - after) / max(before, 1) * 100:.1f}%)')


if __name__ == '__main__':
    main()
