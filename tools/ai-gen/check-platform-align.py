#!/usr/bin/env python3
"""射击台模型对齐检查（Blender 无头）：
重建 firing_platform_spec.json 场景，输出台阶与主体的对齐数据（AABB / 前脸法线 /
台阶位移方向夹角 / 台阶间距 / z 重叠），并渲染两张参考图（管线标准视角 + 正视）。
用法：
    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
        --python check-platform-align.py
"""
import bpy
import json
import math
import os
import sys

import mathutils

SPEC = os.environ.get("FP_SPEC", r"tools\ai-gen\_depth_templates\firing_platform_spec.json")
OUT = os.environ.get("FP_OUT", r"tools\ai-gen\_platform_align")
os.makedirs(OUT, exist_ok=True)

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


def aabb(o):
    corners = [o.matrix_world @ mathutils.Vector(v) for v in o.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


print("== AABBs (minx,maxx | miny,maxy | minz,maxz) ==")
for i, o in enumerate(objs):
    a = aabb(o)
    mat = spec["primitives"][i].get("material", "wall")
    print(
        f"{i:2d} {mat:6s} x[{a[0]:7.1f},{a[1]:7.1f}] y[{a[2]:7.1f},{a[3]:7.1f}] "
        f"z[{a[4]:7.1f},{a[5]:7.1f}]"
    )

body = objs[-1]
rot = math.radians(44.8)
lx = mathutils.Vector((math.cos(rot), math.sin(rot), 0))   # 主体局部 x
ly = mathutils.Vector((-math.sin(rot), math.cos(rot), 0))  # 主体局部 y
print("\nbody local x:", [round(v, 3) for v in lx])
print("body local y:", [round(v, 3) for v in ly])
n = -ly  # 朝相机（-Y）一侧的前脸法线
print("body front-face normal:", [round(v, 3) for v in n])

print("\n== stair displacement vs body front-face normal ==")
bc = mathutils.Vector(body.location)
for i, o in enumerate(objs[:-1]):
    d = mathutils.Vector(o.location) - bc
    dxy = mathutils.Vector((d.x, d.y))          # 仅 XY 投影（楼梯在地面的走向）
    nxy = mathutils.Vector((n.x, n.y)).normalized()
    ang = math.degrees(math.acos(max(-1, min(1, dxy.dot(nxy) / dxy.length)))) if dxy.length else 0
    # 沿法线的面间间隙：台阶背面（局部 -y 面）到主体前脸（局部 y=-42）
    ly = mathutils.Vector((-0.704, 0.710, 0))   # 主体局部 y
    local_y = d.dot(ly)                          # 台阶中心在主体局部 y 坐标
    gap = (-42.0 - (local_y - 15.0))             # 背面 local y = 中心-15；主体前脸 local y=-42
    print(
        f"stair {i:2d} pos=({o.location.x:6.1f},{o.location.y:6.1f},{o.location.z:5.1f}) "
        f"disp_xy_angle_to_normal={ang:5.1f}deg  back_face_gap={gap:6.1f}"
    )

print("\n== step stacking (world z overlap per adjacent pair) ==")
for i in range(1, len(objs) - 1):
    a = aabb(objs[i - 1])
    b = aabb(objs[i])
    print(
        f"prim{i-1} vs prim{i}: z[{max(a[4], b[4]):6.1f}..{min(a[5], b[5]):6.1f}] "
        f"overlap={min(a[5], b[5]) - max(a[4], b[4]):6.1f}"
    )

# ============ 渲染参考图 ============
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# 管线标准视角（俯仰 30° 正面）
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 320
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -180, 104)
cam.rotation_euler = (math.radians(60), 0, 0)
scene.camera = cam
scene.render.filepath = os.path.abspath(os.path.join(OUT, "platform_iso.png"))
bpy.ops.render.render(write_still=True)

# 正视（沿 +Y 看，正面立面）
cam2_data = bpy.data.cameras.new("cam2")
cam2_data.type = "ORTHO"
cam2_data.ortho_scale = 320
cam2 = bpy.data.objects.new("cam2", cam2_data)
scene.collection.objects.link(cam2)
cam2.location = (0, -160, 30)
cam2.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam2
scene.render.filepath = os.path.abspath(os.path.join(OUT, "platform_front.png"))
bpy.ops.render.render(write_still=True)

print("rendered ->", os.path.join(OUT, "platform_iso.png"))
print("rendered ->", os.path.join(OUT, "platform_front.png"))
