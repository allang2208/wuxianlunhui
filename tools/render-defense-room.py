# -*- coding: utf-8 -*-
"""世界-122 基地菱形掩体房渲染复现（与 _buildBaseRoom + GameScene 精灵映射一致）。

用途：快速视觉/像素级检查入口两侧墙底边对齐，迭代房间参数时无需启动游戏。
渲染逻辑与 JS 完全同源：
  - 掩体 sprite：display 260 x round(260/aspect)，中心位于 (x, y - sizeH/2)，即底边中心在 (x,y)
  - 贴图为 1024x1024 原图整体缩放（含透明边）
  - 水平翻转由 _h 贴图承载（镜像），精灵不旋转
"""
from PIL import Image
import math
import os
import sys

T = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain'
OUT_DIR = r'Y:\工作\无尽轮回\scratch\world122\verify'
os.makedirs(OUT_DIR, exist_ok=True)

# ---- 与 defense-system.js DEFENSE_CONFIG 同源 ----
ROOM = {
    'rx': 512, 'ry': 256,
    'coverGrade': 'D',
    'cornerExtend': 45,
    'openEdge': 'RB', 'openRadius': 90,
    'doorAlignY': 0,
}
BASE = {'x': 900, 'y': 2048}
COVER_DISPLAY_W = 260
COVER_ASPECT = {'D': {'h': 1.004, 'v': 1.004}}

# 与 defense-system.js 一致：开口上侧所有掩体整体下移 doorAlignY
DOOR_ALIGN_Y = ROOM['doorAlignY']
# 与 defense-system.js COVER_FACE 同源（6 级统一）：v: A(-88,-21) B(88,-108)；h 镜像
COVER_FACE = {
    'v': {'A': (-88, -21), 'B': (88, -108)},
    'h': {'A': (-88, -108), 'B': (88, -21)},
}
JOIN_OVERLAP = 40  # 端帽叠合（= building-system SNAP_OVERLAP）
FACE_OVERLAY = os.environ.get('FACE_OVERLAY', '') == '1'


def build_layout():
    room = ROOM
    b = BASE
    T = (b['x'], b['y'] - room['ry'])
    R = (b['x'] + room['rx'], b['y'])
    B = (b['x'], b['y'] + room['ry'])
    L = (b['x'] - room['rx'], b['y'])
    edges = [
        ('TL', T, L, 'v'),
        ('TR', T, R, 'h'),
        ('LB', L, B, 'h'),
        ('RB', R, B, 'v'),
    ]
    face = COVER_FACE['v']
    face_len = math.hypot(face['B'][0] - face['A'][0], face['B'][1] - face['A'][1])
    step = face_len - JOIN_OVERLAP
    corner_ext = room.get('cornerExtend', 45)
    open_edge = room['openEdge']
    open_radius = room.get('openRadius', 90)
    layout = []
    for key, frm, to, orient in edges:
        dx = to[0] - frm[0]
        dy = to[1] - frm[1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        span = ln + 2 * corner_ext
        n = max(2, math.ceil((span - face_len) / step) + 1)
        spacing = (span - face_len) / (n - 1) if n > 1 else 0
        t0 = -corner_ext + face_len / 2
        open_mid = ln / 2 if key == open_edge else None
        for i in range(n):
            t = t0 + i * spacing
            f0 = t - face_len / 2
            f1 = t + face_len / 2
            if open_mid is not None and f1 > open_mid - open_radius and f0 < open_mid + open_radius:
                continue
            layout.append({
                'x': round(frm[0] + ux * t),
                'y': round(frm[1] + uy * t) + (DOOR_ALIGN_Y if (open_mid is not None and t < open_mid) else 0),
                'orient': orient,
                'grade': room['coverGrade'],
            })
    return layout


def load_tex(name):
    im = Image.open(os.path.join(T, name)).convert('RGBA')
    return im


def render_room(scale=1.0):
    layout = build_layout()
    margin = 120
    cx0 = BASE['x'] - ROOM['rx'] - margin
    cy0 = BASE['y'] - ROOM['ry'] - margin
    w = int((ROOM['rx'] * 2 + margin * 2) * scale)
    h = int((ROOM['ry'] * 2 + margin * 2) * scale)
    canvas = Image.new('RGBA', (w, h), (14, 14, 16, 255))
    tex_cache = {}
    for c in layout:
        key = f"{c['grade']}_{c['orient']}"
        if key not in tex_cache:
            tex_cache[key] = load_tex('obstacle_cover_%s_%s.png' % (c['grade'], c['orient']))
        tex = tex_cache[key]
        aspect = COVER_ASPECT[c['grade']][c['orient']]
        size_h = round(COVER_DISPLAY_W / aspect)
        dw = int(round(COVER_DISPLAY_W * scale))
        dh = int(round(size_h * scale))
        resized = tex.resize((dw, dh), Image.LANCZOS)
        # 精灵中心 (x, y - sizeH/2)，底边中心 (x,y)
        px = round((c['x'] - cx0) * scale) - dw // 2
        py = round((c['y'] - cy0) * scale) - dh
        canvas.paste(resized, (px, py), resized)
    if FACE_OVERLAY:
        from PIL import ImageDraw
        dr = ImageDraw.Draw(canvas)
        segs = []
        for c in layout:
            gf = COVER_FACE[c['orient']]
            segs.append((
                ((c['x'] + gf['A'][0] - cx0) * scale, (c['y'] + gf['A'][1] - cy0) * scale),
                ((c['x'] + gf['B'][0] - cx0) * scale, (c['y'] + gf['B'][1] - cy0) * scale),
            ))
        for s in segs:
            dr.line([s[0], s[1]], fill=(255, 0, 255, 255), width=max(1, int(round(1.5 * scale))))
    return canvas, layout


def main():
    canvas, layout = render_room(1.0)
    tag = 'v2'
    out = os.path.join(OUT_DIR, f'room_render_full_{tag}.png')
    canvas.convert('RGB').save(out)
    print('saved', out, 'covers:', len(layout))

    b = BASE
    R = (b['x'] + ROOM['rx'], b['y'])
    B = (b['x'], b['y'] + ROOM['ry'])
    dx, dy = B[0] - R[0], B[1] - R[1]
    ln = math.hypot(dx, dy)
    ux, uy = dx / ln, dy / ln
    open_mid = ln / 2
    ex = R[0] + ux * open_mid
    ey = R[1] + uy * open_mid
    # 入口特写（宽幅，包含整条 RB 边）
    zoom = 2.4
    half_w = 430
    half_h = 330
    canvas2, _ = render_room(zoom)
    margin = 120
    cx0 = BASE['x'] - ROOM['rx'] - margin
    cy0 = BASE['y'] - ROOM['ry'] - margin
    scale = zoom
    zx = round((ex - cx0) * scale)
    zy = round((ey - cy0) * scale)
    x0 = max(0, zx - half_w)
    y0 = max(0, zy - half_h)
    crop = canvas2.crop((x0, y0, min(canvas2.width, zx + half_w), min(canvas2.height, zy + half_h)))
    out2 = os.path.join(OUT_DIR, f'room_render_entrance_{tag}.png')
    crop.convert('RGB').save(out2)
    print('saved', out2, 'crop origin world:', x0 / zoom + cx0, y0 / zoom + cy0)

    # RB 边整段特写（从 R 到 B）
    zoom3 = 1.5
    canvas3, _ = render_room(zoom3)
    mid_x = (R[0] + B[0]) / 2
    mid_y = (R[1] + B[1]) / 2
    zx3 = round((mid_x - cx0) * zoom3)
    zy3 = round((mid_y - cy0) * zoom3)
    x03 = max(0, zx3 - 560)
    y03 = max(0, zy3 - 420)
    crop3 = canvas3.crop((x03, y03, min(canvas3.width, zx3 + 560), min(canvas3.height, zy3 + 420)))
    out3 = os.path.join(OUT_DIR, f'room_render_rb_edge_{tag}.png')
    crop3.convert('RGB').save(out3)
    print('saved', out3, 'crop origin world:', x03 / zoom3 + cx0, y03 / zoom3 + cy0)


if __name__ == '__main__':
    main()
