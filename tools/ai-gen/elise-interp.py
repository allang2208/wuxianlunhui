#!/usr/bin/env python3
"""伊莉丝 walk/run 动作 RIFE 插帧（2026-08-21）。

流程：抽格 → RGB 透明区最近色填充（防边缘黑晕）→ RIFE 分别插 RGB 与 alpha(灰度)
→ 重组中间帧 → 交错重建 sheet → 更新 companion-config.json。

- walk：12 帧循环 → 24 帧（含 11→0 回绕缝），网格 4×3 → 5×5，fps 14→28（周期不变）。
- run：起步段 0-9 不动；循环段 10-21（12 帧）→ 24 帧（含 21→10 回绕缝），
  网格 5×5 → 5×7（起步 10 + 循环 24 = 34 格），循环 fps 16→32（周期不变）。

RIFE 不保留 alpha：alpha 作为灰度图单独过 RIFE 再取亮度回贴。
原图备份：assets/companions/elise/_backup_before_interp_20260821/。

用法：python tools/ai-gen/elise-interp.py [--dry-run]
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
DIR = os.path.join(ROOT, 'assets', 'companions', 'elise')
BACKUP = os.path.join(DIR, '_backup_before_interp_20260821')
RIFE = os.path.join(ROOT, '..', '_tmp', 'elise_audit', 'rife',
                    'rife-ncnn-vulkan-20221029-windows', 'rife-ncnn-vulkan.exe')
WORK = os.path.join(ROOT, '..', '_tmp', 'elise_audit', 'interp_work')
MODEL = 'rife-v4.6'

CELL = 640


def bleed_rgb(arr):
    """透明区 RGB 用最近不透明像素颜色填充（距离变换索引），防止插帧边缘黑晕。"""
    rgb = arr[..., :3].astype(np.float32)
    opaque = arr[..., 3] > 8
    if opaque.all() or (~opaque).sum() == 0:
        return arr[..., :3]
    _, inds = ndimage.distance_transform_edt(~opaque, return_indices=True)
    filled = rgb[inds[0], inds[1]]
    return filled.astype(np.uint8)


def extract_cells(sheet_path, cols, rows, count):
    img = Image.open(sheet_path).convert('RGBA')
    arr = np.asarray(img)
    cells = []
    for i in range(count):
        oc, orow = i % cols, i // cols
        cells.append(arr[orow * CELL:(orow + 1) * CELL, oc * CELL:(oc + 1) * CELL].copy())
    return cells


def rife_pair(a_path, b_path, out_path):
    subprocess.run(
        [RIFE, '-0', a_path, '-1', b_path, '-o', out_path, '-m', MODEL],
        check=True, capture_output=True, timeout=120,
    )


def interpolate(frames, tag):
    """frames: RGBA uint8 列表（循环序列，含尾→首回绕）。返回交错后的 2N 帧。"""
    work = os.path.join(WORK, tag)
    os.makedirs(work, exist_ok=True)
    n = len(frames)
    mids = []
    for i in range(n):
        a = frames[i]
        b = frames[(i + 1) % n]
        a_rgb = os.path.join(work, f'a{i:02d}_rgb.png')
        b_rgb = os.path.join(work, f'b{i:02d}_rgb.png')
        a_al = os.path.join(work, f'a{i:02d}_a.png')
        b_al = os.path.join(work, f'b{i:02d}_a.png')
        m_rgb = os.path.join(work, f'm{i:02d}_rgb.png')
        m_al = os.path.join(work, f'm{i:02d}_a.png')
        Image.fromarray(bleed_rgb(a)).save(a_rgb)
        Image.fromarray(bleed_rgb(b)).save(b_rgb)
        Image.fromarray(a[..., 3]).save(a_al)
        Image.fromarray(b[..., 3]).save(b_al)
        if not os.path.exists(m_rgb):
            rife_pair(a_rgb, b_rgb, m_rgb)
        if not os.path.exists(m_al):
            rife_pair(a_al, b_al, m_al)
        rgb = np.asarray(Image.open(m_rgb).convert('RGB'))
        al = np.asarray(Image.open(m_al).convert('L'))
        mid = np.dstack([rgb, al])
        mids.append(mid)
        print(f'  {tag} mid {i} done')
    out = []
    for i in range(n):
        out.append(frames[i])
        out.append(mids[i])
    return out


def rebuild_sheet(frames, cols, rows, out_path, backup_name):
    h = rows * CELL
    w = cols * CELL
    out = np.zeros((h, w, 4), dtype=np.uint8)
    for i, f in enumerate(frames):
        oc, orow = i % cols, i // cols
        out[orow * CELL:(orow + 1) * CELL, oc * CELL:(oc + 1) * CELL] = f
    os.makedirs(BACKUP, exist_ok=True)
    bak = os.path.join(BACKUP, backup_name)
    if not os.path.exists(bak):
        Image.open(out_path).save(bak)
    Image.fromarray(out).save(out_path, format='PNG')
    print(f'  wrote {out_path} ({len(frames)} 帧, {cols}x{rows})')


def main(dry_run):
    # ---- walk：12 → 24（循环含回绕缝） ----
    walk_path = os.path.join(DIR, 'walking.png')
    walk = extract_cells(walk_path, 4, 3, 12)
    if dry_run:
        print(f'walk: {len(walk)} 帧待插 → 24；run 循环段 12 → 24')
        return
    walk24 = interpolate(walk, 'walk')
    rebuild_sheet(walk24, 5, 5, walk_path, 'walking.png')

    # ---- run：起步 0-9 原样，循环 10-21 → 24 ----
    run_path = os.path.join(DIR, 'running.png')
    run = extract_cells(run_path, 5, 5, 23)
    start, loop = run[:10], run[10:22]
    loop24 = interpolate(loop, 'runloop')
    rebuild_sheet(start + loop24, 5, 7, run_path, 'running.png')

    # ---- 更新 companion-config.json ----
    cfg_path = os.path.join(ROOT, 'data', 'companion-config.json')
    raw = open(cfg_path, 'rb').read().decode('utf-8')
    repls = [
        ('"frameWidth": 640, "frameHeight": 640, "cols": 4, "rows": 3,\r\n          "frameCount": 12, "frames": [0, 11], "frameRate": 14, "repeat": -1',
         '"frameWidth": 640, "frameHeight": 640, "cols": 5, "rows": 5,\r\n          "frameCount": 24, "frames": [0, 23], "frameRate": 28, "repeat": -1', 'walk 24f@28'),
        ('"frameCount": 23, "frames": [0, 22],\r\n          "startFrames": [0, 9], "startFrameRate": 16, "startRepeat": 0,\r\n          "loopFrames": [10, 21], "frameRate": 16, "repeat": -1',
         '"frameCount": 34, "frames": [0, 33],\r\n          "startFrames": [0, 9], "startFrameRate": 16, "startRepeat": 0,\r\n          "loopFrames": [10, 33], "frameRate": 32, "repeat": -1', 'run 循环 24f@32'),
    ]
    for old, new, tag in repls:
        cnt = raw.count(old)
        if cnt != 1:
            raise SystemExit(f'FAIL 配置锚点 {tag}: {cnt}')
        raw = raw.replace(old, new)
        print('  config OK', tag)
    open(cfg_path, 'wb').write(raw.encode('utf-8'))
    import json
    json.load(open(cfg_path, encoding='utf-8'))
    print('配置 JSON 校验通过')


if __name__ == '__main__':
    if not os.path.exists(RIFE):
        raise SystemExit(f'RIFE 未找到: {RIFE}')
    main('--dry-run' in sys.argv)
