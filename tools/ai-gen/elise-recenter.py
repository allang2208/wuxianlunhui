#!/usr/bin/env python3
"""伊莉丝动作精灵图水平重对中（2026-08-21 v2，躯干/脚底双锚点方案）。

背景：elise-sprite-align.py v2 用"全内容质心对齐格心"——挥剑/伸盾时质心被四肢带偏，
身体反而被推到对侧；实测逐帧 bbox 中心摆动 walk ±36 / run 循环段 ±52 / attack ±127，
六动作平均中心互不一致（动作切换横跳 30~70px）。

v2 锚点选型（逐带实测驱动，见审计日志）：
- 躯干带（内容高 30%~55% 质心 x）：走/跑/防御最稳（std 8~10），且不随四肢伸展偏移；
  用于 idle/walk/run/defend **硬锁定**到格心。
- 脚底带（底部 12% 质心 x）：攻击时脚不动躯干动，冲刺趋势应保留；
  用于 attack **平滑**（3 帧滑动平均 + 相邻帧跳变 ≤40px），整条曲线平移到
  "首尾站姿帧锚点 = idle 站姿脚底锚点"（跨动作不跳）。
- windmill 不重切：内容宽 860/896 余量 ±18px，任何重对中都会被 clamp 打回，
  且 v2 质心锁定对旋转剑弧本身是合理锚；其 173px bbox 跳变是旋转内容固有。

只整像素平移格内内容（不重采样/不缩放，无损）；越界 clamp 并告警。

用法：
  python tools/ai-gen/elise-recenter.py            # 原地回写（自动备份到 _backup_before_recenter_20260821/）
  python tools/ai-gen/elise-recenter.py --dry-run  # 只出报告不写文件
"""
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
DIR = os.path.join(ROOT, 'assets', 'companions', 'elise')
BACKUP = os.path.join(DIR, '_backup_before_recenter_20260821')

ALPHA_MIN = 32          # 锚点度量口径（避开软边晕）
FEET_BAND = 0.12        # 脚底带 = 内容底部 12% 行
FEET_BAND_MIN = 24
TORSO_BAND = (0.30, 0.55)  # 躯干带 = 内容高 30%~55%
MIN_BAND_MASS = 200
MAX_STEP = 40           # attack 相邻帧锚点跳变上限（px）

# name -> (cellW, cellH, cols, rows, frame_count, policy, anchor)
SHEETS = {
    'idle.png':      (512, 512, 1, 1, 1, 'lock', 'torso'),
    'walking.png':   (640, 640, 4, 3, 12, 'lock', 'torso'),
    'running.png':   (640, 640, 5, 5, 23, 'lock', 'torso'),
    'defending.png': (640, 640, 4, 5, 19, 'lock', 'torso'),
    'attacking.png': (960, 1024, 5, 6, 28, 'smooth', 'feet'),
    # windmill.png  intentionally skipped（见模块 docstring）
}


def band_cx(mask, top, bottom, f0, f1):
    h = bottom - top + 1
    band = mask[top + int(h * f0): top + int(h * f1) + 1, :]
    if band.sum() < MIN_BAND_MASS:
        return None
    return float(np.where(band)[1].mean())


def anchor_x(cell, kind):
    """躯干带或脚底带的质心 x；失败回退全内容质心。"""
    m = cell[..., 3] > ALPHA_MIN
    if m.sum() == 0:
        return None
    ys, xs = np.where(m)
    top, bottom = int(ys.min()), int(ys.max())
    if kind == 'torso':
        v = band_cx(m, top, bottom, TORSO_BAND[0], TORSO_BAND[1])
        if v is not None:
            return v
    else:
        h = bottom - top + 1
        band_h = max(FEET_BAND_MIN, int(h * FEET_BAND))
        band = m[bottom - band_h + 1:bottom + 1, :]
        if band.sum() >= MIN_BAND_MASS:
            return float(np.where(band)[1].mean())
    return float(xs.mean())


def smooth_series(values, max_step):
    n = len(values)
    sm = []
    for i in range(n):
        lo, hi = max(0, i - 1), min(n, i + 2)
        sm.append(sum(values[lo:hi]) / (hi - lo))
    out = [sm[0]]
    for i in range(1, n):
        d = sm[i] - out[i - 1]
        if abs(d) > max_step:
            d = max_step * (1 if d > 0 else -1)
        out.append(out[i - 1] + d)
    return out


def shift_cell(cell, dx):
    h, w = cell.shape[:2]
    m = cell[..., 3] > 8
    if m.sum() == 0:
        return cell, 0
    xs = np.where(m)[1]
    left, right = int(xs.min()), int(xs.max())
    dx_min, dx_max = -left, w - 1 - right
    dx_real = int(max(dx_min, min(dx_max, dx)))
    if dx_real == 0:
        return cell, 0
    out = np.zeros_like(cell)
    if dx_real > 0:
        out[:, dx_real:] = cell[:, :w - dx_real]
    else:
        out[:, :dx_real] = cell[:, -dx_real:]
    return out, dx_real


def recenter(fname, spec, dry_run, idle_feet_rel):
    cell_w, cell_h, cols, rows, frame_count, policy, anchor_kind = spec
    path = os.path.join(DIR, fname)
    img = Image.open(path).convert('RGBA')
    arr = np.asarray(img).copy()
    assert img.width == cols * cell_w and img.height == rows * cell_h, f'{fname} 网格不匹配'

    cells, anchors = [], []
    for i in range(frame_count):
        oc, orow = i % cols, i // cols
        cell = arr[orow * cell_h:(orow + 1) * cell_h, oc * cell_w:(oc + 1) * cell_w].copy()
        if (cell[..., 3] > 8).sum() <= 300:
            cells.append(None); anchors.append(None)
            continue
        cells.append(cell)
        anchors.append(anchor_x(cell, anchor_kind))

    valid = [a for a in anchors if a is not None]
    if not valid:
        print(f'FAIL {fname}: 无有效帧')
        return False, idle_feet_rel

    center = cell_w / 2.0
    if policy == 'lock':
        targets = [center] * len(anchors)
    else:
        idxs = [i for i, a in enumerate(anchors) if a is not None]
        sm = smooth_series([anchors[i] for i in idxs], MAX_STEP)
        stance = sm[:2] + sm[-2:]
        # 跨动作基准：首尾站姿帧锚点 = 格心 + idle 站姿脚底相对偏移
        stance_target = center + (idle_feet_rel or 0.0)
        offset = stance_target - (sum(stance) / len(stance))
        tgt = {i: s + offset for i, s in zip(idxs, sm)}
        targets = [tgt.get(i) for i in range(len(anchors))]

    out = np.zeros_like(arr)
    warns = []
    new_anchors = []
    for i, cell in enumerate(cells):
        if cell is None:
            continue
        oc, orow = i % cols, i // cols
        dx = int(round(targets[i] - anchors[i]))
        moved, dx_real = shift_cell(cell, dx)
        if dx_real != dx:
            warns.append(f'f{i}: 平移 clamp {dx}→{dx_real}（内容贴边）')
        out[orow * cell_h:(orow + 1) * cell_h, oc * cell_w:(oc + 1) * cell_w] = moved
        new_anchors.append(anchor_x(moved, anchor_kind))

    a_valid = [a for a in new_anchors if a is not None]
    a_std = float(np.std(a_valid))
    a_span = max(a_valid) - min(a_valid)
    print(f'{"DRY " if dry_run else "OK  "}{fname}: policy={policy} anchor={anchor_kind} '
          f'锚点 std={a_std:.1f} span={a_span:.1f}')
    seq = ', '.join(f'{i}:{a - center:+.0f}' for i, a in enumerate(new_anchors) if a is not None)
    print(f'     新锚点序列(相对格心): {seq}')
    for wmsg in warns:
        print('  WARN', wmsg)

    # idle 完成后回报其脚底锚点相对格心的偏移，供 attack 跨动作对齐
    new_idle_feet_rel = idle_feet_rel
    if fname == 'idle.png':
        oc = out[0:cell_h, 0:cell_w]
        fx = anchor_x(oc, 'feet')
        if fx is not None:
            new_idle_feet_rel = fx - center
            print(f'     idle 站姿脚底锚点相对格心: {new_idle_feet_rel:+.1f}')

    if not dry_run:
        os.makedirs(BACKUP, exist_ok=True)
        bak = os.path.join(BACKUP, fname)
        if not os.path.exists(bak):
            shutil.copy2(path, bak)
        Image.fromarray(out).save(path, format='PNG')
    return True, new_idle_feet_rel


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    ok = True
    idle_feet_rel = 0.0
    for f, spec in SHEETS.items():
        r, idle_feet_rel = recenter(f, spec, dry, idle_feet_rel)
        ok &= r
    if not dry:
        print('备份目录:', BACKUP)
    raise SystemExit(0 if ok else 1)
