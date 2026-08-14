#!/usr/bin/env python3
"""露娜 running 水平漂移归一化（2026-08-12）：
AI 生成的 running.png 每帧人物沿水平方向漂移（帧 19 包围盒 x46-465 → 帧 31 x22-489），
导致 run 循环 31→19 回跳时人物整体横跳 ~25px（闪回卡顿）。本脚本把 32 帧按内容质心
水平对齐（避免裁切、保持 512×512），导出 running_norm.png，使循环回跳退化为普通
帧间变化（对齐后 31 vs 19 差异 0.068 ≈ 相邻帧同级）。

用法：python luna-run-align.py [--in assets/.../running.png] [--out assets/.../running_norm.png]
"""
import argparse
import numpy as np
from PIL import Image


def frame_rgba(img, f, cols, fw, fh):
    fx = (f % cols) * fw
    fy = (f // cols) * fh
    return np.array(img.crop((fx, fy, fx + fw, fy + fh)))


def measure(rgba):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), float(xs.mean()), float(ys.mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', default='assets/companions/luna/running.png')
    ap.add_argument('--out', dest='dst', default='assets/companions/luna/running_norm.png')
    ap.add_argument('--cell', type=int, default=512)
    ap.add_argument('--cols', type=int, default=8)
    args = ap.parse_args()

    img = Image.open(args.src).convert('RGBA')
    fw = fh = args.cell
    cols = args.cols
    n = (img.width // fw) * (img.height // fh)
    frames = [frame_rgba(img, f, cols, fw, fh) for f in range(n)]
    info = [measure(r) for r in frames]

    # 求水平对齐参考：让所有帧内容都完整落在 [2, 510] 内，并尽量接近 256
    lo = 2
    hi = fw - 2
    lower = max(lo + c - x0 for (x0, _, x1, _, c, _) in info if x1 is not None)
    upper = min(hi + c - x1 for (x0, _, x1, _, c, _) in info if x1 is not None)
    if lower > upper:
        print(f'警告：无可行区间 lower={lower:.1f} upper={upper:.1f}，回退参考 256')
        ref = 256.0
    else:
        ref = max(lower, min(upper, 256.0))
    print(f'{n} 帧，水平参考 X = {ref:.1f}（可行区间 {lower:.1f} ~ {upper:.1f}）')

    out = Image.new('RGBA', (img.width, img.height), (0, 0, 0, 0))
    for f in range(n):
        rgba = frames[f]
        m = info[f]
        if m is None:
            continue
        x0, y0, x1, y1, cx, cy = m
        shift = int(round(ref - cx))
        fx = (f % cols) * fw
        fy = (f // cols) * fh
        cell = Image.fromarray(rgba, 'RGBA')
        out.paste(cell, (fx + shift, fy), cell)

    out.save(args.dst)
    print('saved', args.dst)

    # 校验：输出帧质心应 ≈ ref
    out_img = Image.open(args.dst).convert('RGBA')
    cxs = []
    for f in range(n):
        m = measure(frame_rgba(out_img, f, cols, fw, fh))
        if m is not None:
            cxs.append(m[4])
    print(f'输出质心 X：min {min(cxs):.1f} max {max(cxs):.1f} 跨度 {max(cxs)-min(cxs):.1f}px')


if __name__ == '__main__':
    main()
