# -*- coding: utf-8 -*-
"""地砖草层四向对称化：解决随机镜像后草"倒过来/偏到一边"的问题

问题（2026-08-16 用户反馈）：AI 生成的草是侧视草叶、集中在某侧，游戏地板
随机 X/Y 镜像后草朝向/位置翻转，违和。原草地砖（swampbrick-new1）草是俯视
苔藓、分布均衡，镜像无感。

做法：只对称化"草"通道（绿主导像素），泥地细节保持原样——
草掩码与其 4 个镜像并集，草色取 4 个镜像源中最绿者。结果草的位置/朝向
四向对称，任意翻转视觉不变；mud 噪点不参与对称，不产生镜像重复感。

用法：python tools/ai-gen/make-tile-mirrorsafe.py <输入.png> <输出.png> [--grass-thr 25] [--target-frac 0.10]
  --grass-thr：绿主导判定阈值 G>R+thr（默认 25；越大草越少越"纯绿"）
  --target-frac：可选目标草占比，按 4 镜像整组抽稀（默认 None=不抽稀）
  --flatten-edge：把边缘带的平均亮度归一化到内部水平（消除 AI 渲染的
  菱形边缘变暗/"厚度"感；原 swampbrick-new1 边缘带差 ≈0.1）
"""
from PIL import Image
import numpy as np
import sys


def main():
    src, dst = sys.argv[1], sys.argv[2]
    grass_thr = 25
    if '--grass-thr' in sys.argv:
        grass_thr = int(sys.argv[sys.argv.index('--grass-thr') + 1])
    target_frac = None
    if '--target-frac' in sys.argv:
        target_frac = float(sys.argv[sys.argv.index('--target-frac') + 1])
    flatten_edge = '--flatten-edge' in sys.argv
    im = Image.open(src).convert('RGBA')
    a = np.array(im).astype(np.int16)
    H, W = a.shape[:2]
    alpha = a[:, :, 3]

    # 0. 先做边缘压平（在草识别之前，避免压平改变草/泥判定破坏对称）
    if flatten_edge:
        rgb = a[:, :, :3].astype(np.float64)
        mask0 = alpha > 200
        cx, cy = W / 2, H / 2
        rx, ry = W / 2 * 0.98, H / 2 * 0.98
        yy, xx = np.mgrid[0:H, 0:W]
        ax = np.minimum(np.abs(xx - cx), np.abs((W - 1 - xx) - cx))
        ay = np.minimum(np.abs(yy - cy), np.abs((H - 1 - yy) - cy))
        d = 1 - (ax / rx + ay / ry)
        lum = rgb.mean(axis=2)
        core = lum[mask0 & (d > 0.4)]
        if core.size > 0:
            core_lum = core.mean()
            for k in range(15):
                lo, hi = k * 0.02, (k + 1) * 0.02
                band = mask0 & (d >= lo) & (d < hi)
                if band.sum() == 0:
                    continue
                bl = lum[band].mean()
                if bl > 0:
                    factor = min(1.25, max(0.85, core_lum / bl))
                    rgb[band] *= factor
            a = np.dstack([np.clip(rgb, 0, 255).astype(np.int16), alpha])

    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    grass = (g > r + grass_thr) & (g > b + grass_thr) & (alpha > 180)

    # 4 个镜像源（含原图）
    srcs = [a, a[:, ::-1], a[::-1, :], a[::-1, ::-1]]
    grass_srcs = [grass, grass[:, ::-1], grass[::-1, :], grass[::-1, ::-1]]

    # 对称草掩码 = 4 镜像并集
    sym = grass_srcs[0] | grass_srcs[1] | grass_srcs[2] | grass_srcs[3]

    # 可选：按 4 镜像整组抽稀到目标密度（保持对称性）
    if target_frac is not None and sym.mean() > target_frac:
        idx = np.arange(H * W).reshape(H, W)
        mir = [idx, idx[:, ::-1], idx[::-1, :], idx[::-1, ::-1]]
        rep_all = np.minimum.reduce(mir)
        reps = rep_all[sym]
        groups, inverse = np.unique(reps, return_inverse=True)
        sizes = np.bincount(inverse)
        order = np.random.default_rng(7).permutation(len(groups))
        keep = np.zeros(len(groups), dtype=bool)
        total = 0
        for gi in order:
            if total >= target_frac * H * W:
                break
            keep[gi] = True
            total += sizes[gi]
        sym = np.isin(rep_all, groups[keep])

    # 对每个对称草像素，取 4 个镜像源中"最绿"的草色
    greens = np.stack([np.where(gs, gs_im, -1) for gs_im, gs in
                       zip([s[:, :, 1] for s in srcs], grass_srcs)], axis=0)
    best = np.argmax(greens, axis=0)

    out = a.copy()
    for i in range(4):
        sel = sym & (best == i)
        if sel.any():
            out[sel] = srcs[i][sel]
    # 被抽稀/阈值剔除的"原草"像素：取第一个非草镜像源（泥色），保证草掩码仍对称
    not_sym = grass & ~sym
    for i in range(4):
        prev = np.zeros(not_sym.shape, dtype=bool)
        for j in range(i):
            prev |= grass_srcs[j]
        sel = not_sym & (~grass_srcs[i]) & (~prev)
        if sel.any():
            out[sel] = srcs[i][sel]
    out = Image.fromarray(out.astype(np.uint8), 'RGBA')
    out.save(dst, optimize=True)

    # 验证：翻转后草掩码不变
    a2 = np.array(out).astype(np.int16)
    g2 = a2[:, :, 1]
    gmask = (g2 > a2[:, :, 0] + grass_thr) & (g2 > a2[:, :, 2] + grass_thr) & (a2[:, :, 3] > 180)
    ok_x = bool((gmask == gmask[:, ::-1]).all())
    ok_y = bool((gmask == gmask[::-1, :]).all())
    top = gmask[:H // 2].sum(); bot = gmask[H // 2:].sum()
    lef = gmask[:, :W // 2].sum(); rig = gmask[:, W // 2:].sum()
    print(f'{dst}: {out.size}  草占比 {round(100*gmask.mean(), 2)}%  '
          f'T/B {round(top/max(bot,1), 2)}  L/R {round(lef/max(rig,1), 2)}  '
          f'镜像不变 X:{ok_x} Y:{ok_y}')


main()
