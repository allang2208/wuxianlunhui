#!/usr/bin/env python3
"""露娜 walking/running 精灵图重建（2026-08-15，用 walking and running.mp4）。

分段（24fps, 121 帧）：
  - walking 循环：f12-37（26 帧，回跳对齐差异 0.017 无缝）
  - running 起步：f81-97（17 帧，播一次）
  - running 循环：f98-120（23 帧，回跳 0.086 = 素材最优）

管线：PyAV 抽帧 → BiRefNet（ComfyUI-RMBG）抠图 → 对齐（脚底固定 + 水平质心居中）
      → 拼 512×512 sheet（walk 8×4 / run 8×5）。
必须用 ComfyUI venv python 运行（依赖 torch + ComfyUI-RMBG 模型）：
  & ComfyUI\\.venv\\Scripts\\python.exe tools/ai-gen/luna-wr-rebuild.py
"""

import os
import sys

import av
import numpy as np
from PIL import Image

from rmbg_cutout import get_model, predict_alpha

VIDEO = 'tools/verify-shots/luna-src/wr.mp4'
SEGMENTS = {
    'walk': list(range(12, 38)),        # f12-37
    'run_start': list(range(81, 98)),   # f81-97
    'run_loop': list(range(98, 121)),   # f98-120
}
CELL = 512
TARGET_H = 470
FEET_Y = 478
CENTER_X = 256
OUT_DIR = 'assets/companions/luna'


def load_frames():
    container = av.open(VIDEO)
    stream = container.streams.video[0]
    frames = []
    for frame in container.decode(stream):
        frames.append(np.array(frame.to_image().convert('RGB')))
    container.close()
    return frames


def make_rgba(rgb, alpha):
    """unpremultiply 防白边/灰边：alpha 反推前景色"""
    a = alpha.astype(np.float32) / 255.0
    a3 = np.clip(a, 1e-4, 1.0)[..., None]
    out_rgb = np.clip(rgb.astype(np.float32) / a3, 0, 255).astype(np.uint8)
    return np.dstack([out_rgb, alpha.astype(np.uint8)])


def align_cell(rgba):
    """对齐三锚：统一高度 + 脚底固定 + 水平质心精确居中（循环回跳无位置跳动）"""
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return np.zeros((CELL, CELL, 4), np.uint8), None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    h = y1 - y0
    scale = TARGET_H / h
    nw = max(1, int(round((x1 - x0 + 1) * scale)))
    nh = max(1, int(round((y1 - y0 + 1) * scale)))
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    im = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    # 内容质心（缩放后）精确对齐 CENTER_X；若导致裁切则退回 bbox 居中
    content_cx = (float(xs.mean()) - x0) * scale
    px = int(round(CENTER_X - content_cx))
    if px < 2 or px + nw > CELL - 2:
        px = int(round(CENTER_X - nw / 2))
    py = FEET_Y - nh
    if py < 2:
        py = 2
    cell = np.zeros((CELL, CELL, 4), np.uint8)
    cell[py:py + nh, px:px + nw] = np.array(im)
    # 质心（输出校验用）
    a = cell[:, :, 3]
    ys2, xs2 = np.where(a > 16)
    cx = float(xs2.mean()) if len(xs2) else 0
    info = {'cx': cx, 'nw': nw, 'nh': nh}
    return cell, info


def compose(cells, cols):
    rows = (len(cells) + cols - 1) // cols
    sheet = np.zeros((rows * CELL, cols * CELL, 4), np.uint8)
    for i, cell in enumerate(cells):
        r, c = divmod(i, cols)
        sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cell
    return Image.fromarray(sheet, 'RGBA')


def main():
    frames = load_frames()
    model = get_model()
    os.makedirs(OUT_DIR, exist_ok=True)

    for key, idxs in SEGMENTS.items():
        cells = []
        infos = []
        for i in idxs:
            rgb = frames[i]
            alpha = predict_alpha(model, Image.fromarray(rgb))
            rgba = make_rgba(rgb, alpha)
            cell, info = align_cell(rgba)
            cells.append(cell)
            infos.append(info)
        cxs = [inf['cx'] for inf in infos if inf]
        print(f'{key}: {len(cells)} 帧 质心跨度 {max(cxs)-min(cxs):.1f}px '
              f'(min {min(cxs):.1f} max {max(cxs):.1f})')
        if key == 'walk':
            img = compose(cells, 8)
            out = os.path.join(OUT_DIR, 'walking.png')
        else:
            # run_start + run_loop 合并为一个 sheet（40 帧 8×5）
            continue
        img.save(out)
        print('  saved', out, img.size)

    # run：start 17 + loop 23 = 40 帧
    run_cells = []
    run_infos = []
    for key in ['run_start', 'run_loop']:
        cells = []
        infos = []
        for i in SEGMENTS[key]:
            rgb = frames[i]
            alpha = predict_alpha(model, Image.fromarray(rgb))
            cell, info = align_cell(make_rgba(rgb, alpha))
            cells.append(cell)
            infos.append(info)
        run_cells += cells
        run_infos += infos
        cxs = [inf['cx'] for inf in infos if inf]
        print(f'{key}: {len(cells)} 帧 质心跨度 {max(cxs)-min(cxs):.1f}px')
    cxs = [inf['cx'] for inf in run_infos if inf]
    print(f'run 合并: {len(run_cells)} 帧 质心跨度 {max(cxs)-min(cxs):.1f}px')
    img = compose(run_cells, 8)
    out = os.path.join(OUT_DIR, 'running.png')
    img.save(out)
    print('  saved', out, img.size)


if __name__ == '__main__':
    main()
