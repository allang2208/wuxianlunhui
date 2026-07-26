# -*- coding: utf-8 -*-
"""门闸贴图墙顶对齐：逐列竖向 warp，使墙顶线平行底边且墙高匹配直墙显示比例
背景：直墙显示墙高比 = wallH/baseDy = 691/757 = 0.9128；门闸贴图原为 254~267/317.3 且
墙顶线左右斜率不一致(0.40/0.73, 源视频透视)，拼接处墙顶落差 17~26px（用户报"错位"）。
目标：门闸墙顶线 ∥ 底边，墙高 = 0.9128×317.3 ≈ 290 tex px（拱门区 raw<1 不压缩，k=1）。
左端底边 y=248 < 290，帧内容需整体下移 shift=46 扩帧（595 → 641），同步更新 wall-gate-geo.json。
（教训：首版先把内容封顶在原帧内再扩帧，顺序反了导致 warp 失效——必须先扩帧再 warp。）
"""
import json
import numpy as np
from PIL import Image

SHEET = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain/wall_gate.png'
GEO = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/wall-gate-geo.json'
FW, FH, COLS = 640, 595, 4
BASE_L, BASE_R = (4.0, 248.0), (634.0, 565.3)
TARGET_H = 290.0       # 目标墙高（tex px）：匹配直墙 691/757 显示比例
MARGIN_TOP = 4
SHIFT = int(round(TARGET_H - BASE_L[1] + MARGIN_TOP))  # 左端新墙顶 = 248-290 = -42 → 下移 46
NFH = FH + SHIFT

def base_at(x):
    return BASE_L[1] + (x - BASE_L[0]) * (BASE_R[1] - BASE_L[1]) / (BASE_R[0] - BASE_L[0])

def median_filter(v, k=9):
    h = k // 2
    out = v.copy()
    for i in range(len(v)):
        out[i] = np.median(v[max(0, i - h):i + h + 1])
    return out

sheet = Image.open(SHEET).convert('RGBA')
assert sheet.size == (FW * COLS, FH * COLS), sheet.size

frames = []
for fi in range(16):
    fx, fy = (fi % COLS) * FW, (fi // COLS) * FH
    orig = np.array(sheet.crop((fx, fy, fx + FW, fy + FH))).astype(np.float32)
    a = orig[:, :, 3]
    # 每列内容顶行（连续≥3行才算，防散点）
    top = np.full(FW, np.nan)
    for x in range(FW):
        rows = np.nonzero(a[:, x] > 64)[0]
        if len(rows) >= 3:
            top[x] = rows[2]
    xs = np.arange(FW)
    ok = ~np.isnan(top)
    top = np.interp(xs, xs[ok], top[ok])
    top = median_filter(top)
    # 先在扩帧画布（595+SHIFT）里就位，再在扩帧坐标系 warp——否则左端新墙顶
    # （原坐标负数）会在 warp 阶段被帧顶裁掉，SHIFT 无法挽回
    fr = np.zeros((NFH, FW, 4), np.float32)
    fr[SHIFT:SHIFT + FH] = orig
    out = fr.copy()
    for x in range(FW):
        b = base_at(x) + SHIFT
        d = b - (top[x] + SHIFT)
        if d < 10:
            continue
        raw = TARGET_H / d
        k = raw if raw > 1.0 else 1.0   # 墙区拉伸到 290；拱门区 raw<1 保持 k=1 不压缩
        if abs(k - 1.0) < 1e-3:
            continue
        r_new = np.arange(NFH, dtype=np.float32)
        src = np.where(r_new < b, b - (b - r_new) / k, r_new)
        src = np.clip(src, 0, NFH - 1)
        for c in range(4):
            out[:, x, c] = np.interp(src, r_new, fr[:, x, c])
    frames.append(out)
print(f'warp 完成: shift={SHIFT} 新帧高={NFH}')

new_sheet = Image.new('RGBA', (FW * COLS, NFH * COLS), (0, 0, 0, 0))
for fi, fr in enumerate(frames):
    im = Image.fromarray(np.clip(fr, 0, 255).astype(np.uint8))
    fx, fy = (fi % COLS) * FW, (fi // COLS) * NFH
    new_sheet.paste(im, (fx, fy), im)
new_sheet.save(SHEET, optimize=True)
print(f'精灵图表重打包: {new_sheet.size} -> {SHEET}')

# 校验：warp 后第0帧墙区顶边线应 ∥ 底边且距底边 ≈ TARGET_H
a0 = np.array(new_sheet.crop((0, 0, FW, NFH)))[:, :, 3]
def fit_top(xlo, xhi):
    xs2, ys2 = [], []
    for x in range(xlo, xhi):
        rows = np.nonzero(a0[:, x] > 64)[0]
        if len(rows) >= 3:
            xs2.append(x); ys2.append(rows[2])
    return np.polyfit(xs2, ys2, 1)
tl = fit_top(20, 230)
tr = fit_top(430, 620)
bslope = (BASE_R[1] - BASE_L[1]) / (BASE_R[0] - BASE_L[0])
b0 = BASE_L[1] + SHIFT
hL = (b0 + bslope * (135 - 4)) - (tl[0] * 135 + tl[1])
hR = (b0 + bslope * (495 - 4)) - (tr[0] * 495 + tr[1])
print(f'校验: 左墙顶斜率={tl[0]:.4f} 右墙顶斜率={tr[0]:.4f} (底边 {bslope:.4f}) 墙高 L={hL:.1f} R={hR:.1f} (目标 {TARGET_H})')

geo = {
    'frameW': FW, 'frameH': NFH, 'frames': 16,
    'slope': round(bslope, 4),
    'base': [[BASE_L[0], round(BASE_L[1] + SHIFT, 1)], [BASE_R[0], round(BASE_R[1] + SHIFT, 1)]],
    'wallH': TARGET_H,
    'note': '墙顶线已 warp 至平行底边、墙高290(匹配直墙691/757显示比例)；帧高595+shift46=641',
}
with open(GEO, 'w', encoding='utf-8') as fp:
    json.dump(geo, fp, ensure_ascii=False, indent=1)
print('geo:', json.dumps(geo, ensure_ascii=False))
