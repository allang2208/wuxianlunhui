#!/usr/bin/env python3
"""手绘剪影深度模板 v2（2026-08-04，ControlNet 固定视角 + 水平/垂直双方向）。

所有模板统一：1024×1024、黑底（远）、主体白渐变（近）、正面 billboard、居中、
底边平齐 y≈880。每个形状生成 _h / _v 一对（_v = 水平镜像），
形状带非对称细节（头偏/冠偏/侧阶/侧芽），用于验证 ControlNet 能否锁住朝向。
近=白（DepthAnything 可视化惯例）。产出 tools/ai-gen/_depth_templates/。
"""
import os

from PIL import Image, ImageDraw, ImageOps

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_depth_templates")
os.makedirs(OUT, exist_ok=True)
SIZE = 1024
BOTTOM = 880


def base_canvas():
    im = Image.new("L", (SIZE, SIZE), 0)
    return im, ImageDraw.Draw(im)


def soft_top(d, x0, y0, x1, y1, light=255):
    band_h = max(2, int((y1 - y0) * 0.3))
    for i in range(band_h):
        v = int(190 + (light - 190) * (i / band_h))
        d.rectangle([x0, y0 + i, x1, y0 + i + 1], fill=v)
    d.rectangle([x0, y0 + band_h, x1, y1], fill=light)


def make(name, draw_fn):
    im, d = base_canvas()
    draw_fn(im, d)
    im.save(os.path.join(OUT, f"depth_{name}_h.png"))
    ImageOps.mirror(im).save(os.path.join(OUT, f"depth_{name}_v.png"))
    print("saved", f"depth_{name}_h.png", "& _v")


def draw_box(im, d, w=560, h=380, side_step=False):
    x0 = (SIZE - w) // 2
    y0 = BOTTOM - h
    d.rounded_rectangle([x0, y0, x0 + w, BOTTOM], radius=28, fill=255)
    soft_top(d, x0, y0, x0 + w, y0 + int(h * 0.35))
    if side_step:  # 非对称：右下角凸出台阶
        d.rectangle([x0 + int(w * 0.62), BOTTOM - 90, x0 + int(w * 0.88), BOTTOM], fill=255)


def draw_wide(im, d, w=780, h=170, raised_left=False):
    x0 = (SIZE - w) // 2
    y0 = BOTTOM - h
    d.rounded_rectangle([x0, y0, x0 + w, BOTTOM], radius=22, fill=255)
    soft_top(d, x0, y0, x0 + w, y0 + int(h * 0.3))
    if raised_left:  # 非对称：左端立起矮墙
        d.rounded_rectangle([x0, y0 - 130, x0 + int(w * 0.22), BOTTOM], radius=16, fill=255)


def draw_figure(im, d):
    cy = SIZE // 2
    # 头（微偏左，非对称）
    d.ellipse([cy - 95 + 30, 250, cy + 95 + 30, 440], fill=255)
    soft_top(d, cy - 95 + 30, 250, cy + 95 + 30, 320)
    # 身体
    d.rounded_rectangle([cy - 130, 400, cy + 130, 720], radius=30, fill=255)
    # 双臂横杆（左臂略长，非对称）
    d.rounded_rectangle([cy - 340, 450, cy + 320, 560], radius=24, fill=255)
    # 腿/底座
    d.rounded_rectangle([cy - 90, 720, cy + 90, BOTTOM], radius=20, fill=255)


def draw_triangle(im, d, w=520, h=620):
    x0 = (SIZE - w) // 2
    y0 = BOTTOM - h
    d.polygon([(x0, BOTTOM), (SIZE // 2, y0), (x0 + w, BOTTOM)], fill=255)
    # 门洞（偏左，非对称）
    d.rounded_rectangle([x0 + int(w * 0.30), BOTTOM - 240, x0 + int(w * 0.52), BOTTOM], radius=10, fill=0)
    soft_top(d, x0, y0, x0 + w, y0 + int(h * 0.2))


def draw_tree_round(im, d, canopy_r=230, trunk_w=100, trunk_h=300, shift=40):
    cy = SIZE // 2
    d.ellipse([cy - canopy_r + shift, 180, cy + canopy_r + shift, 180 + canopy_r * 2], fill=255)
    d.ellipse([cy - canopy_r + 80 + shift, 110, cy + canopy_r + 80 + shift, 110 + canopy_r * 2], fill=255)
    d.ellipse([cy - canopy_r - 80 + shift, 130, cy + canopy_r - 80 + shift, 130 + canopy_r * 2], fill=255)
    d.rounded_rectangle([cy - trunk_w // 2, 560, cy + trunk_w // 2, 560 + trunk_h], radius=14, fill=255)
    soft_top(d, cy - canopy_r + shift, 180, cy + canopy_r + shift, 300)


def draw_tree_pine(im, d, canopy_r=170, trunk_w=110, trunk_h=420, lean=35):
    cy = SIZE // 2
    d.polygon([(cy - canopy_r + lean, 620), (cy, 90), (cy + canopy_r + lean, 620)], fill=255)
    d.polygon([(cy - int(canopy_r * 0.72) + lean, 480), (cy, 40), (cy + int(canopy_r * 0.72) + lean, 480)], fill=255)
    d.rounded_rectangle([cy - trunk_w // 2, 560, cy + trunk_w // 2, 560 + trunk_h], radius=14, fill=255)


def draw_tree_dead(im, d, canopy_r=120, trunk_w=80, trunk_h=430, lean=45):
    cy = SIZE // 2
    # 主干 + 偏侧枯枝（非对称）
    d.rounded_rectangle([cy - trunk_w // 2, 430, cy + trunk_w // 2, 430 + trunk_h], radius=12, fill=255)
    d.rounded_rectangle([cy, 430, cy + 90 + lean, 560], radius=10, fill=255)
    d.rounded_rectangle([cy + lean, 330, cy + lean + 70, 430], radius=10, fill=255)
    d.rounded_rectangle([cy - 90, 330, cy - 20 + lean, 400], radius=10, fill=255)
    d.ellipse([cy - canopy_r + lean, 250, cy + canopy_r + lean, 250 + canopy_r * 2], fill=200)


def draw_box_tall(im, d, w=360, h=560):
    x0 = (SIZE - w) // 2
    y0 = BOTTOM - h
    d.rounded_rectangle([x0, y0, x0 + w, BOTTOM], radius=24, fill=255)
    soft_top(d, x0, y0, x0 + w, y0 + int(h * 0.25))
    # 顶部凸沿（偏左，非对称）
    d.rounded_rectangle([x0 - 26, y0 - 40, x0 + int(w * 0.45), y0 + 10], radius=10, fill=255)


if __name__ == "__main__":
    make("box", lambda im, d: draw_box(im, d, side_step=True))
    make("box_tall", lambda im, d: draw_box_tall(im, d))
    make("wide", lambda im, d: draw_wide(im, d, raised_left=True))
    make("figure", draw_figure)
    make("triangle", draw_triangle)
    make("tree_round", lambda im, d: draw_tree_round(im, d, shift=45))
    make("tree_pine", lambda im, d: draw_tree_pine(im, d, lean=40))
    make("tree_dead", lambda im, d: draw_tree_dead(im, d, lean=50))
    print("done")
