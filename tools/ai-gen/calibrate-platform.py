#!/usr/bin/env python3
"""射击台重渲染后标定：Blender 无头重建场景 → 管线相机 → 输出关键点投影到
裁剪贴图的像素坐标（供 FiringPlatform 台面菱形/台阶走廊/精灵锚点标定）。
用法： blender --background --python calibrate-platform.py
"""
import bpy
import json
import math
import os
import sys

import mathutils
import numpy as np

SPEC = os.environ.get("FP_SPEC", r"tools\ai-gen\_depth_templates\firing_platform_spec.json")
SRC = os.environ.get("FP_SRC", r"tools\ai-gen\_platform_align\platform_render_1024.png")

with open(SPEC, encoding="utf-8") as f:
    spec = json.load(f)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

objs = []
for i, p in enumerate(spec["primitives"]):
    bpy.ops.mesh.primitive_cube_add(size=2)
    o = bpy.context.active_object
    w, d, h = p["size"]
    o.scale = (w / 2, d / 2, h / 2)
    o.location = p.get("pos", [0, 0, 0])
    o.rotation_euler = [math.radians(a) for a in p.get("rot", [0, 0, 0])]
    o.name = f"prim_{i}"
    objs.append(o)

# 用与渲染管线相同的相机（文件名带横杠，直接 exec 取 setup_camera）
spec_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render-cover-real.py")
ns = {}
exec(compile(open(spec_path, encoding="utf-8").read(), spec_path, "exec"), ns)
setup_camera = ns["setup_camera"]
cam = setup_camera(spec, objs)
scene = bpy.context.scene
scene.camera = cam
bpy.context.view_layer.update()

# 渲染像素与相机映射
cam_data = cam.data
s = cam_data.ortho_scale
shift_x = cam_data.shift_x
shift_y = cam_data.shift_y
inv = np.array(cam.matrix_world.inverted())

# 裁剪原点（alpha bbox 左上角，由外部 PIL 计算后经环境变量传入）
x0 = int(float(os.environ.get("FP_X0", 170)))
y0 = int(float(os.environ.get("FP_Y0", 367)))
x1 = int(float(os.environ.get("FP_X1", 853)))
y1 = int(float(os.environ.get("FP_Y1", 885)))


def project(wx, wy, wz):
    """世界点 → 裁剪贴图像素坐标。"""
    p = np.array([wx, wy, wz, 1.0]) @ inv.T
    px = (p[0] - shift_x * s) / s * 1024.0 + 512.0
    py = 512.0 - (p[1] - shift_y * s) / s * 1024.0  # 图像 y 向下
    return (px - x0, py - y0)


print(f"camera: ortho_scale={s:.3f} shift_x={shift_x:.4f} shift_y={shift_y:.4f}")
print(f"render alpha bbox: ({x0},{y0})-({x1},{y1})  crop=({x1-x0+1}x{y1-y0+1})")
print(f"world x range for scale: {(-150.2, 192.56)}")

# 台面四角（主体顶面 z=102）
deck = [
    ("C1 back", 91.1, 177.5, 102),
    ("C2 right", 150.3, 117.9, 102),
    ("C3 front", -91.1, -121.5, 102),
    ("C4 left", -150.3, -60.1, 102),
]
print("\n== deck corners (crop px) ==")
for name, x, y, z in deck:
    px, py = project(x, y, z)
    print(f"{name:10s} ({px:7.1f},{py:7.1f})")

# 三级踏面顶面中心 + 四角（light 材质，z=30/60/90，中心 (61.3,-33.8)/(40.1,-12.5)/(19.0,8.8)）
steps = [
    ("step1", 61.3, -33.8, 30),
    ("step2", 40.1, -12.5, 60),
    ("step3", 19.0, 8.8, 90),
]
print("\n== stair tread top centers + corners (crop px) ==")
for name, cx_, cy_, cz in steps:
    px, py = project(cx_, cy_, cz)
    # 踏面四角（局部 x ±170, y ±15, z 顶）
    corners = []
    for lx in (-170, 170):
        for ly in (-15, 15):
            wx = cx_ + 0.710 * lx - 0.704 * ly
            wy = cy_ + 0.704 * lx + 0.710 * ly
            corners.append(project(wx, wy, cz + 4))
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    print(f"{name} center=({px:6.1f},{py:6.1f}) top-face bbox x[{min(xs):6.1f},{max(xs):6.1f}] y[{min(ys):6.1f},{max(ys):6.1f}]")

# 入口：底阶（step1 riser z0-26）前下角 = 踏面1 前方地面接触点
print("\n== entrance (step1 front-bottom ground) ==")
for ly in (15,):
    for lz in (-13, -4):
        wx = 61.3 + 0.710 * 0 - 0.704 * ly
        wy = -33.8 + 0.704 * 0 + 0.710 * ly
        wz = 13 + lz
        px, py = project(wx, wy, wz)
        print(f"step1 local(0,{ly},{lz}) -> ({px:7.1f},{py:7.1f})")
