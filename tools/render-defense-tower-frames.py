#!/usr/bin/env python3
"""防御塔机械臂 3D 旋转帧渲染（2026-08-14）：
简版机械臂 = 竖枢轴柱固定在底座圆心 + 一根水平圆柱杆连接尾端 + 弧形钩（accent）勾起武器。
绕塔顶枢轴轴（0,0,Z_PIVOT）在 Blender 里旋转 N 帧（默认 48，每 7.5°），
固定等距正交相机逐帧渲染 —— 每一帧都是真 3D 等距透视，游戏内按 aimAngle 选帧。

用法：blender --background --python render-defense-tower-frames.py -- out_dir frames ortho_scale [metal_tex.png]
可选第 4 参：金属材质贴图（PNG），覆盖机械臂全部件（竖柱/横杆/钩子）。
产出：out_dir/frame_%03d.png（1024×1024，透明底），供 prep-defense-tower-frames.py 打包。
"""
import bpy
import math
import os
import sys
import importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("rdt", os.path.join(_HERE, "render-defense-tower.py"))
rdt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rdt)

SIZE = 1024
Z_PIVOT = 177.0


def build_arm_bent(steel, dark, light, accent):
    """简版机械臂 + 尾端挂载钩（2026-08-14 用户定稿）：
    竖枢轴柱固定在底座圆心 + 一根水平圆柱杆连接尾端 + 弧形钩（accent）勾起武器。
    钩子 = 竖直面内上半圆环（XZ 平面拱形），武器贴图挂在钩中心。"""
    objs = []
    z = Z_PIVOT
    # 竖枢轴柱（固定在底座圆心，枢轴=其中心 z=Z_PIVOT）
    objs.append(rdt.add_cylinder("pivot", 18, 44, z, dark))
    # 杆根加固环（枢轴柱侧）
    objs.append(rdt.add_cylinder("collar", 11, 8, z, light, x=8))
    # 水平连接杆：一根圆柱从枢轴柱连到尾端挂载件
    objs.append(rdt.add_hbeam("beam", 6, 50, 8, z, steel, seg=10))
    # 尾端弧形钩（XZ 平面上半圆环，accent 色）：枪械挂在钩上
    objs.append(add_hook("weapon_hook", 50, z, 7.0, 2.2, accent))
    return objs


def add_hook(name, x, z, R, r, mat):
    """竖直面（XZ 平面）上半圆环钩：primitive_torus 绕 X 转 90° 后删除下半段。"""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=R, minor_radius=r,
        major_segments=32, minor_segments=10,
        location=(x, 0, z))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    import bmesh
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(o.data)
    for v in bm.verts:
        if v.co.z < z - 0.1:
            v.select = True
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.select], context="VERTS")
    bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.data.materials.append(mat)
    return o


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) < 3:
        sys.exit("usage: blender --background --python render-defense-tower-frames.py -- out_dir frames ortho_scale [metal_tex.png]")
    out_dir, frames, ortho_scale = argv[0], int(argv[1]), float(argv[2])
    metal_tex = argv[3] if len(argv) > 3 else None
    os.makedirs(out_dir, exist_ok=True)

    if metal_tex:
        # 金属贴图覆盖机械臂全部件（竖柱/横杆/钩子统一金属材质；2026-08-15）
        metal = rdt.textured_material("metal", metal_tex)
        steel = dark = light = accent = metal
    else:
        steel = rdt.flat_material("steel", (0.44, 0.47, 0.52), 0.6, 0.35)
        dark = rdt.flat_material("dark", (0.30, 0.33, 0.38), 0.7, 0.3)
        light = rdt.flat_material("light", (0.60, 0.63, 0.68), 0.5, 0.4)
        accent = rdt.flat_material("accent", (0.82, 0.44, 0.12), 0.5, 0.2)

    rdt.clear_scene()
    rdt.setup_lighting()
    objs = build_arm_bent(steel, dark, light, accent)
    cam = rdt.setup_camera(objs, ortho_scale, target=(20, 0, Z_PIVOT))
    bpy.context.scene.camera = cam

    # 枢轴空物体：绕 Z 轴旋转整臂
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, Z_PIVOT))
    pivot_empty = bpy.context.active_object
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = pivot_empty
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    step = 360.0 / frames
    for i in range(frames):
        pivot_empty.rotation_euler = (0, 0, math.radians(i * step))
        scene.render.filepath = os.path.join(out_dir, f"frame_{i:03d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"frame {i}/{frames} saved")


if __name__ == "__main__":
    main()
