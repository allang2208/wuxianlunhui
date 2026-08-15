#!/usr/bin/env python3
"""仓鼠矿工 walking 水平漂移归一化（2026-08-15）：
AI 生成的 walking.png 每帧人物沿水平方向漂移（帧0 cx≈239 → 帧8~11 cx≈281，
跨度 ~44px），循环 [2,11] 回跳（帧11→帧2）人物横跳 ~31px，导致移动「闪回」。
按 SKILL 沉淀经验（luna-run-align：内容质心水平对齐；luna-wr-rebuild：脚底 FEET_Y 固定）：
- 水平：每帧内容质心 x 对齐到可行参考 X（避免裁切，尽量接近 256）；
- 垂直：每帧内容底边（脚底）固定到 FEET_Y（默认 480），保持 512×512。
输出 walking_norm.png；对齐后目标：水平质心跨度 <2px、循环回跳差异与相邻帧同级。
用法：python tools/ai-gen/hamster-walk-align.py [--in <walking.png>] [--out <walking_norm.png>]
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
    ap.add_argument('--in', dest='src', default='assets/companions/hamster_miner/walking.png')
    ap.add_argument('--out', dest='dst', default='assets/companions/hamster_miner/walking_norm.png')
    ap.add_argument('--cell', type=int, default=512)
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--feet-y', type=int, default=480)
    args = ap.parse_args()

    img = Image.open(args.src).convert('RGBA')
    fw = fh = args.cell
    cols = args.cols
    n = (img.width // fw) * (img.height // fh)
    frames = [frame_rgba(img, f, cols, fw, fh) for f in range(n)]
    info = [measure(r) for r in frames]

    lo, hi = 2, fw - 2
    lower = max(lo + m[4] - m[0] for m in info if m is not None)
    upper = min(hi + m[4] - m[2] for m in info if m is not None)
    ref_x = max(lower, min(upper, 256.0)) if lower <= upper else 256.0
    feet_y = args.feet_y
    print(f'{n} 帧，水平参考 X = {ref_x:.1f}（可行区 {lower:.1f} ~ {upper:.1f}），脚底 Y = {feet_y}')

    out = Image.new('RGBA', (img.width, img.height), (0, 0, 0, 0))
    for f in range(n):
        rgba = frames[f]
        m = info[f]
        if m is None:
            continue
        x0, y0, x1, y1, cx, cy = m
        dx = int(round(ref_x - cx))
        dy = int(round(feet_y - y1))
        if x0 + dx < 0 or x1 + dx >= fw or y0 + dy < 0 or y1 + dy >= fh:
            print(f'警告：帧 {f} 平移 ({dx},{dy}) 越界，跳过')
            continue
        shifted = np.zeros_like(rgba)
        if dy >= 0:
            dst_y0, src_y0, h = dy, 0, fh - dy
        else:
            dst_y0, src_y0, h = 0, -dy, fh + dy
        if dx >= 0:
            dst_x0, src_x0, w = dx, 0, fw - dx
        else:
            dst_x0, src_x0, w = 0, -dx, fw + dx
        shifted[dst_y0:dst_y0 + h, dst_x0:dst_x0 + w] = rgba[src_y0:src_y0 + h, src_x0:src_x0 + w]
        fx = (f % cols) * fw
        fy = (f // cols) * fh
        out.paste(Image.fromarray(shifted, 'RGBA'), (fx, fy))

    out.save(args.dst)
    out2 = Image.open(args.dst).convert('RGBA')
    ni = [measure(frame_rgba(out2, f, cols, fw, fh)) for f in range(n)]
    cxs = [m[4] for m in ni if m]
    cys = [m[5] for m in ni if m]
    bots = [m[3] for m in ni if m]
    print('对齐后 cx 跨度:', round(max(cxs) - min(cxs), 1),
          'cy 跨度:', round(max(cys) - min(cys), 1),
          '脚底范围:', min(bots), '-', max(bots))


if __name__ == '__main__':
    main()
