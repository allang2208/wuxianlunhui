#!/usr/bin/env python3
"""仓鼠系动画脚底线纵向对齐（2026-08-21）。

批量审计发现部分 walk/dying 表逐帧内容底边跳动（单位走路上下颠、 dying 单帧闪低）：
shooter walk 帧 0 为异源大帧（配置侧已剔除，[0,10]→[1,10]）、priest/light_cavalry/
miner/warrior walk 底边 std 3.5~5.5、musketeer dying 帧 7 离群低 121px。

处理：逐帧内容底边（alpha>10）对齐到**该表中位数**——中位数不变 → 既有 spriteOffsetY/
footOffsetY 锚定全部保持有效；整像素竖移，不重采样、不改水平。越界 clamp 并告警。
原图备份 assets/companions/_backup_feet_align_20260821/。

用法：python tools/ai-gen/hamster-feet-align.py [--dry-run]
"""
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
BACKUP = os.path.join(ROOT, 'assets', 'companions', '_backup_feet_align_20260821')
ALPHA_MIN = 10

# (src, fw, fh, cols, 处理帧集合(None=全部))
SPECS = [
    ('assets/companions/hamster_shooter/running.png', 512, 512, 8, range(1, 11)),   # 帧 0 配置侧已剔除
    ('assets/companions/hamster_priest/running.png', 512, 512, 8, None),
    ('assets/companions/hamster_light_cavalry/running.png', 512, 512, 8, None),
    ('assets/companions/hamster_miner/walking.png', 512, 512, 8, None),
    ('assets/companions/hamster_warrior/running.png', 512, 512, 8, None),
    ('assets/companions/hamster_musketeer/dying.png', 512, 512, 8, None),
]


def bottom_of(cell):
    m = cell[..., 3] > ALPHA_MIN
    if m.sum() < 50:
        return None
    return int(np.where(m)[0].max())


def align(path, fw, fh, cols, indices, dry_run):
    arr = np.asarray(Image.open(path).convert('RGBA')).copy()
    rows = arr.shape[0] // fh
    if indices is None:
        indices = [i for i in range(cols * rows)
                   if bottom_of(arr[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw]) is not None]
    bottoms = {}
    for i in indices:
        bottoms[i] = bottom_of(arr[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw])
    vals = [b for b in bottoms.values() if b is not None]
    if not vals:
        print(f'FAIL {path}: 无有效帧')
        return False
    median = float(np.median(vals))
    before_std = float(np.std(vals))
    out = arr.copy()
    shifts = []
    for i, b in bottoms.items():
        if b is None:
            continue
        dy = int(round(median - b))
        if dy == 0:
            shifts.append(0)
            continue
        cell = arr[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw]
        m = cell[..., 3] > 8
        ys = np.where(m)[0]
        top, bot = int(ys.min()), int(ys.max())
        dy_real = max(-top, min(fh - 1 - bot, dy))
        if dy_real != dy:
            print(f'  WARN f{i}: 竖移 clamp {dy}→{dy_real}')
        moved = np.zeros_like(cell)
        if dy_real > 0:
            moved[dy_real:, :] = cell[:fh - dy_real, :]
        else:
            moved[:fh + dy_real, :] = cell[-dy_real:, :]
        out[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw] = moved
        shifts.append(dy_real)
    after = []
    for i in bottoms:
        c = out[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw]
        after.append(bottom_of(c))
    after_vals = [b for b in after if b is not None]
    after_std = float(np.std(after_vals))
    tag = os.path.basename(os.path.dirname(path)) + '/' + os.path.basename(path)
    print(f'{"DRY " if dry_run else "OK  "}{tag}: 底边 std {before_std:.1f}→{after_std:.1f} '
          f'(中位数 {median:.0f} 不变) 竖移={shifts}')
    if not dry_run:
        os.makedirs(BACKUP, exist_ok=True)
        name = os.path.basename(os.path.dirname(path)) + '_' + os.path.basename(path)
        bak = os.path.join(BACKUP, name)
        if not os.path.exists(bak):
            shutil.copy2(path, bak)
        Image.fromarray(out).save(path, format='PNG')
    return True


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    ok = True
    for src, fw, fh, cols, idx in SPECS:
        ok &= align(os.path.join(ROOT, src), fw, fh, cols,
                    list(idx) if idx is not None else None, dry)
    if not dry:
        print('备份目录:', BACKUP)
    raise SystemExit(0 if ok else 1)
