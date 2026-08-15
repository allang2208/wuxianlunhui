#!/usr/bin/env python3
"""露娜 spell 动画视频重建（2026-08-15，spelling.mp4）。

视频 121 帧：f0-70 站立施法（起手→咏唱→收手），f77 起后仰倒地——只截取施法段。
抽帧 f0,2,...,70（每 2 帧取 1 = 36 帧）→ BiRefNet 抠图 → 对齐
（TARGET_H=470 / FEET_Y=478 / CENTER_X=256，与 walk/run 同标准）+ 水平限幅
（MAX_WIDTH=300）→ 拼 8×5 sheet。
必须用 ComfyUI venv python 运行：
  & ComfyUI\\.venv\\Scripts\\python.exe tools/ai-gen/luna-spell-video-rebuild.py
"""

import os

import av
import numpy as np
from PIL import Image

from rmbg_cutout import get_model, predict_alpha

VIDEO = 'tools/verify-shots/luna-src/spell.mp4'
INDICES = list(range(0, 71, 2))  # f0,2,...,70 → 36 帧
CELL = 512
TARGET_H = 470
FEET_Y = 478
CENTER_X = 256
OUT = 'assets/companions/luna/spelling.png'


def load_frames():
    container = av.open(VIDEO)
    stream = container.streams.video[0]
    frames = []
    for frame in container.decode(stream):
        frames.append(np.array(frame.to_image().convert('RGB')))
    container.close()
    return frames


def make_rgba(rgb, alpha):
    a = alpha.astype(np.float32) / 255.0
    a3 = np.clip(a, 1e-4, 1.0)[..., None]
    out_rgb = np.clip(rgb.astype(np.float32) / a3, 0, 255).astype(np.uint8)
    return np.dstack([out_rgb, alpha.astype(np.uint8)])


def align_cell(rgba):
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return np.zeros((CELL, CELL, 4), np.uint8), None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    scale = TARGET_H / (y1 - y0)
    nw = max(1, int(round((x1 - x0 + 1) * scale)))
    nh = max(1, int(round((y1 - y0 + 1) * scale)))
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    im = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    # 水平基准：脚底区域（底部 15% 高度）质心——全内容质心会被施法手臂摆动拉偏，
    # 造成"身体/脚部在帧间滑动"的位移感（SKILL 对齐三铁律：水平中心固定防滑步）
    foot_y0 = int(y1 - (y1 - y0) * 0.15)
    foot_mask = ys > foot_y0
    foot_cx = float(xs[foot_mask].mean()) if foot_mask.any() else float(xs.mean())
    content_cx = (foot_cx - x0) * scale
    px = int(round(CENTER_X - content_cx))
    if px < 2 or px + nw > CELL - 2:
        px = int(round(CENTER_X - nw / 2))
    py = FEET_Y - nh
    if py < 2:
        py = 2
    cell = np.zeros((CELL, CELL, 4), np.uint8)
    cell[py:py + nh, px:px + nw] = np.array(im)
    a = cell[:, :, 3]
    ys2, xs2 = np.where(a > 16)
    return cell, {'cx': float(xs2.mean()) if len(xs2) else 0, 'nw': nw, 'nh': nh}


def main():
    frames = load_frames()
    model = get_model()
    cells = []
    infos = []
    for i in INDICES:
        rgb = frames[i]
        alpha = predict_alpha(model, Image.fromarray(rgb))
        cell, info = align_cell(make_rgba(rgb, alpha))
        cells.append(cell)
        infos.append(info)
    cxs = [inf['cx'] for inf in infos if inf]
    nws = [inf['nw'] for inf in infos if inf]
    rows = (len(cells) + 7) // 8
    sheet = np.zeros((rows * CELL, 8 * CELL, 4), np.uint8)
    for i, cell in enumerate(cells):
        r, c = divmod(i, 8)
        sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cell
    Image.fromarray(sheet, 'RGBA').save(OUT)
    print(f'{len(cells)} 帧（f{INDICES[0]}~f{INDICES[-1]}）：'
          f'高度 {min(inf["nh"] for inf in infos if inf)}~{max(inf["nh"] for inf in infos if inf)}、'
          f'宽度 {min(nws)}~{max(nws)}、质心跨度 {max(cxs)-min(cxs):.1f}px')
    print('saved', OUT, Image.open(OUT).size)


if __name__ == '__main__':
    main()
