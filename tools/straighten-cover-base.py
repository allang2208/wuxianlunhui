# -*- coding: utf-8 -*-
"""掩体贴图底边拉直：把底边以下的多余像素削成透明，使底边成为经过
COVER_FACE 端点（世界空间 30° 直线）的严格直线。

背景：2026-08-05 拼接审计——贴图底边轮廓是曲线（两端弧度、中段 -0.62），
端到端拼接时底边线折角 ~3°，视觉上"底部不在同一水平"。skill 沉淀要求
掩体底边必须是 30° 直线（像素斜率验收）。拉直后：
  - 所有掩体底边斜率统一为世界 -104/209（与吸附步长/深度锚线一致）；
  - 端到端拼接（face line 端点贴合）底边严格共线。

用法：python tools/straighten-cover-base.py [--grade D]（默认全 12 张；原图备份 .bak.straighten）
"""
import math
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TERR = os.path.join(ROOT, 'assets', 'terrain')

# 与 defense-system.js COVER_ASPECT 同源（内容框宽高比；h = flip(v) 同款，只取 v）
ASPECT = {
    'F': 1.032, 'E': 1.037, 'D': 1.029, 'C': 1.105, 'B': 0.842, 'A': 1.016,
}
FEATHER = 2  # 直线附近羽化（防锯齿）

# 与 defense-system.js COVER_FACE 同源（显示空间端点，相对 foot），按级别标定
FACE_BY_GRADE = {
    'F': {'v': {'A': (-123, -24), 'B': (111, -151)}, 'h': {'A': (-111, -151), 'B': (123, -24)}},
    'E': {'v': {'A': (-123, -37), 'B': (107, -157)}, 'h': {'A': (-107, -157), 'B': (123, -37)}},
    'D': {'v': {'A': (-105, -41), 'B': (104, -138)}, 'h': {'A': (-104, -138), 'B': (105, -41)}},
    'C': {'v': {'A': (-123, -27), 'B': (114, -142)}, 'h': {'A': (-114, -142), 'B': (123, -27)}},
    'B': {'v': {'A': (-122, -35), 'B': (122, -146)}, 'h': {'A': (-122, -146), 'B': (122, -35)}},
    'A': {'v': {'A': (-123, -24), 'B': (121, -176)}, 'h': {'A': (-121, -176), 'B': (123, -24)}},
}


def line_through(A, B):
    dx = B[0] - A[0]
    dy = B[1] - A[1]
    return dy / dx if dx else 0.0


def straighten(path, grade, orient):
    img = Image.open(path).convert('RGBA')
    W, H = img.size
    alpha = img.getchannel('A')
    arr = bytearray(alpha.tobytes())
    size_h = round(260 / ASPECT[grade])
    # COVER_FACE 端点（该级别，显示空间偏移，相对 foot）→ 原图坐标
    # foot 原图 = (W/2, H)；显示缩放 sx=260/W, sy=sizeH/H
    fa = FACE_BY_GRADE[grade][orient]['A']
    fb = FACE_BY_GRADE[grade][orient]['B']
    A = (W / 2 + fa[0] * W / 260, H + fa[1] * H / size_h)
    B = (W / 2 + fb[0] * W / 260, H + fb[1] * H / size_h)
    k = line_through(A, B)
    removed = 0
    for x in range(W):
        y_line = A[1] + k * (x - A[0])
        for y in range(int(math.ceil(y_line + FEATHER)), H):
            idx = y * W + x
            if arr[idx]:
                arr[idx] = 0
                removed += 1
        # 羽化带：y_line-FEATHER .. y_line+FEATHER 内 alpha 线性衰减
        y0 = max(0, int(math.floor(y_line - FEATHER)))
        y1 = min(H - 1, int(math.ceil(y_line + FEATHER)))
        for y in range(y0, y1 + 1):
            d = y - y_line
            if d <= 0:
                continue
            f = max(0.0, min(1.0, 1.0 - d / FEATHER))
            idx = y * W + x
            if arr[idx]:
                arr[idx] = min(arr[idx], int(255 * f))
    alpha.putdata(arr)
    img.putalpha(alpha)
    bak = path + '.bak.straighten'
    if not os.path.exists(bak):
        shutil.copyfile(path, bak)
    img.save(path)
    print(f'[{grade}{orient}] W{W} H{H} sizeH{size_h} '
          f'A=({A[0]:.1f},{A[1]:.1f}) B=({B[0]:.1f},{B[1]:.1f}) slope={k:.4f} removed={removed}')


def main():
    grades = sys.argv[sys.argv.index('--grade') + 1] if '--grade' in sys.argv else 'FEDCBA'
    for g in grades:
        pv = os.path.join(TERR, f'obstacle_cover_{g}_v.png')
        if not os.path.exists(pv):
            print('skip', pv)
            continue
        straighten(pv, g, 'v')
        # h = flip(v) 同款派生（严禁独立渲染/独立标定，否则 h/v 拼接不对称）
        v = Image.open(pv).convert('RGBA')
        v.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(TERR, f'obstacle_cover_{g}_h.png'))


if __name__ == '__main__':
    main()
