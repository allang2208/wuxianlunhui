# -*- coding: utf-8 -*-
"""端到端拼接底边连续性测试：渲染两段同向 v 掩体（吸附步长 209,-104，可带回退），
追踪拼接处两侧墙段底边线，检查是否共线/有无台阶。"""
import math
import os
from PIL import Image
import numpy as np

T = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain'
OUT = os.environ.get('OUT_DIR', r'Y:\工作\无尽轮回\scratch\world122\verify')
os.makedirs(OUT, exist_ok=True)

COVER_DISPLAY_W = 260
ASPECT = 1.029
SIZE_H = round(COVER_DISPLAY_W / ASPECT)  # 253


def render(segments, scale=1.6):
    xs = [c for (c, _) in segments]
    ys = [cy for (_, cy) in segments]
    x0, x1 = min(xs) - 160, max(xs) + 160
    y0, y1 = min(ys) - 160, max(ys) + 160
    w = int((x1 - x0) * scale)
    h = int((y1 - y0) * scale)
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))  # 透明背景，trace 才不会被背景污染
    tex = Image.open(os.path.join(T, 'obstacle_cover_D_v.png')).convert('RGBA')
    for cx, cy in segments:
        dw = int(round(COVER_DISPLAY_W * scale))
        dh = int(round(SIZE_H * scale))
        resized = tex.resize((dw, dh), Image.LANCZOS)
        px = round((cx - x0) * scale) - dw // 2
        py = round((cy - y0) * scale) - dh
        canvas.paste(resized, (px, py), resized)
    return canvas, (x0, y0, scale)


def trace_bottom(canvas, origin, segs, xrange):
    """在 xrange（世界 x）内逐列找最低墙像素（世界 y），返回点列"""
    a = np.array(canvas)  # RGBA
    wall = a[..., 3] > 128  # 严格 alpha，排除半透明边缘伪影
    x0, y0, scale = origin
    out = []
    for wx in range(xrange[0], xrange[1] + 1):
        cx = int(round((wx - x0) * scale))
        if cx < 0 or cx >= wall.shape[1]:
            continue
        rows = np.where(wall[:, cx])[0]
        if len(rows):
            out.append((wx, rows.max() / scale + y0))
    return out


def fit(pts):
    xs = np.array([p[0] for p in pts], dtype=float)
    ys = np.array([p[1] for p in pts], dtype=float)
    k, b = np.polyfit(xs, ys, 1)
    return k, b


def report(tag, segments):
    canvas, origin = render(segments)
    p = os.path.join(OUT, f'join_{tag}.png')
    canvas.save(p)  # 必须保留 RGBA：trace 读 alpha，转 RGB 会丢透明（黑底被当墙）
    # 拼接处 = 两段墙中心之间；A 段右端约 x1+104，B 段左端约 x2-105
    a, b = segments[0], segments[1]
    join_x = (a[0] + 104 + b[0] - 105) / 2
    left = trace_bottom(canvas, origin, segments, (int(a[0] - 105), int(join_x) - 4))
    right = trace_bottom(canvas, origin, segments, (int(join_x) + 4, int(b[0] + 104)))
    print(f'  [{tag}] trace n: left={len(left)} right={len(right)} '
          f'leftSample={left[:3]} rightSample={right[:3]}')
    kl, bl = fit(left) if len(left) > 8 else (None, None)
    kr, br = fit(right) if len(right) > 8 else (None, None)
    # 两条拟合线在拼接处的 y 差
    d = None
    if kl is not None and kr is not None:
        d = (kl * join_x + bl) - (kr * join_x + br)
    print(f'[{tag}] A=({a[0]},{a[1]}) B=({b[0]},{b[1]}) join_x={join_x:.0f} '
          f'leftSlope={kl and round(kl,3)} rightSlope={kr and round(kr,3)} gapAtJoin={d and round(d,1)}')
    return p


STEP_X, STEP_Y = 209, -97  # D 级 v face 端点 B-A（COVER_FACE.D.v）
# 1) 无回退端到端
report('exact', [(900, 2100), (900 + STEP_X, 2100 + STEP_Y)])
# 2) 吸附回退 8px（沿轴线向 A 移）
ln = math.hypot(STEP_X, STEP_Y)
ux, uy = STEP_X / ln, STEP_Y / ln
back = 8
bx = 900 + STEP_X - ux * back
by = 2100 + STEP_Y - uy * back
report('overlap8', [(900, 2100), (bx, by)])

# 3) 加深重叠：B 伸入 A 40px（盖住贴图端部弧度区 img 77~240 ≈ 显示 42px）
for ov in (20, 30, 40, 50):
    bx2 = 900 + STEP_X - ux * ov
    by2 = 2100 + STEP_Y - uy * ov
    report(f'overlap{ov}', [(900, 2100), (bx2, by2)])
