#!/usr/bin/env python3
"""路线 B：Blender 几何 + AI 材质纹理 → 写实墙段贴图（零裁剪，底边精确直线）。

与 blender-depth-render.py 的区别：
  - 深度脚本只出形状/朝向（喂 ControlNet）；本脚本直接渲染**成品墙段**：
    棱柱几何（底边 30° 直线）由 Blender 精确控制，AI 只提供材质纹理，
    材质贴到棱柱正面/顶面，写实光照（无投影），输出 1024×1024 底边直线贴图。
  - 一图两向：v 渲染 + --mirror 出 h（h = flip v，镜像派生）。

用法（Git Bash 注意引号）：
    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python render-cover-real.py -- spec.json texture.png out.png [--mirror]

Spec JSON（几何，相对单位；pos 指图元中心，z=0 地面）：
  {"primitives": [{"type":"box","size":[230,52,150],"pos":[0,0,75],"rot":[0,0,52]}]}
  rot.z = 52° 对应相机俯仰 30° 下底边投影斜率 ≈ -0.4976（与 COVER_FACE 世界斜率一致，
  已用 iter-cover-depth.py 迭代校准；h 方向用 --mirror 或 rot.z = -52）。
"""
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np

SIZE = 1024


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    mirror = "--mirror" in argv
    argv = [a for a in argv if a != "--mirror"]
    if len(argv) != 3:
        sys.exit("usage: blender --background --python render-cover-real.py -- spec.json texture.png out.png [--mirror]")
    return argv[0], argv[1], argv[2], mirror


def bevel_corners(o, amount=10.0, segments=3):
    """8 个顶角圆滑（2026-08-05 用户要求）：只圆 8 个角顶点，不动长棱边，
    保住底边直线与拼接几何。先 transform_apply(scale) 让 bevel 按世界单位生效，
    再用 bmesh.ops.bevel(affect='VERTICES')（bpy.ops.mesh.bevel 的 affect 参数
    版本间不稳定）。"""
    import bmesh
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(o.data)
    bmesh.ops.bevel(
        bm,
        geom=[v for v in bm.verts],
        offset=amount,
        offset_type="OFFSET",
        segments=segments,
        profile=0.5,
        affect="VERTICES",
    )
    bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")


def box_full_uv(o):
    """每个面独立展开到整张纹理 [0,1]²（盒形展开，V 轴朝上）。

    2026-08-05 修复：Blender 默认 cube 的 UV 是 3×2 分块布局，每张面只采样纹理的
    一小块——材质贴图只有上半部分被显示（E 级沙袋位置错误/白色残留的根因）。
    对每个面按局部坐标主轴投影归一化到 [0,1]²，纹理顶部（v=1）始终朝上。
    """
    me = o.data
    uvl = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        main = max(range(3), key=lambda i: abs(n[i]))
        others = [i for i in range(3) if i != main]
        # V 轴优先世界 Z（向上），其余作 U 轴
        if 2 in others:
            u_ax, v_ax = (others[0], 2) if others[0] != 2 else (others[1], 2)
        else:
            u_ax, v_ax = others[0], others[1]
        coords = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            coords.append((co[u_ax], co[v_ax]))
        u0, u1 = min(c[0] for c in coords), max(c[0] for c in coords)
        v0, v1 = min(c[1] for c in coords), max(c[1] for c in coords)
        du = (u1 - u0) or 1.0
        dv = (v1 - v0) or 1.0
        for li, (cu, cv) in zip(poly.loop_indices, coords):
            uvl.data[li].uv = ((cu - u0) / du, (cv - v0) / dv)
    me.update()


def build_wall(prims, tex_path):
    """建 box 棱柱（8 角可圆滑）+ 写实材质（bump；无 AO 阴影）。"""
    img = bpy.data.images.load(tex_path)
    objs = []
    for i, p in enumerate(prims):
        t = p["type"]
        if t == "box":
            bpy.ops.mesh.primitive_cube_add(size=2)
            o = bpy.context.active_object
            w, d, h = p["size"]
            o.scale = (w / 2, d / 2, h / 2)
        else:
            sys.exit(f"unsupported primitive: {t}")
        o.name = f"wall_{i}"
        o.location = p.get("pos", [0, 0, 0])
        rot = p.get("rot", [0, 0, 0])
        o.rotation_euler = [math.radians(a) for a in rot]
        # 8 角圆滑（用户要求尝试；默认 10 世界 px，spec 可覆盖）
        if p.get("bevel", 0) > 0:
            bevel_corners(o, amount=float(p["bevel"]), segments=int(p.get("bevelSegments", 3)))
        # 每面整张纹理（修默认 cube 分块 UV）
        box_full_uv(o)

        mat = bpy.data.materials.new(f"m_{i}")
        mat.use_nodes = True
        nt = mat.node_tree
        nodes, links = nt.nodes, nt.links
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.85
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Closest" if img.size[0] < 512 else "Linear"
        # 纹理直连 Base Color（可靠；AO/Mix 在 EEVEE 输出不稳定会把墙刷成纯色）
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        # 适度 bump：细节立体感但不生硬/不产生阴影感（0.42 太深 = 生硬，用户反馈）
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        bump.inputs["Distance"].default_value = 0.25
        links.new(tex.outputs["Color"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        o.data.materials.append(mat)
        objs.append(o)
    return objs


def wedge_ends(obj, L, T):
    """端部薄片（底边共线）：背面底角移到正面平面沿底边外延，顶部保留厚度。"""
    import bmesh
    bpy.context.view_layer.update()
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        x, y, z = v.co
        if abs(x - 1) < 0.01 and y > 0 and z < 0:
            v.co.x = 1 + T / L
            v.co.y = -1
        elif abs(x + 1) < 0.01 and y > 0 and z < 0:
            v.co.x = -1 - T / L
            v.co.y = -1
    bm.to_mesh(me)
    bm.free()
    me.transform(obj.matrix_world)
    obj.scale = (1, 1, 1)
    obj.rotation_euler = (0, 0, 0)


def setup_camera(spec, objs):
    """正交相机：俯仰 30° 正面，底边落 y≈880（与深度管线同一取景口径）。"""
    elevation = math.radians(spec.get("elevation", 30))
    azimuth = math.radians(spec.get("azimuth", 0))
    bottom_y = spec.get("bottom_y", 880)
    max_w_frac = spec.get("max_width_frac", 0.8)
    top_margin = spec.get("top_margin_px", 64)

    bpy.context.view_layer.update()
    corners = []
    for o in objs:
        for c in o.bound_box:
            corners.append(o.matrix_world @ mathutils.Vector(c))
    ws = np.array([[c.x, c.y, c.z] for c in corners])
    extent = float(np.max(ws.max(axis=0) - ws.min(axis=0)))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, extent * 10)
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)

    dist = max(20.0, extent * 4)
    cam.location = (
        dist * math.cos(elevation) * math.sin(azimuth),
        -dist * math.cos(elevation) * math.cos(azimuth),
        dist * math.sin(elevation),
    )
    cam.rotation_euler = (math.radians(90) - elevation, 0, azimuth)
    bpy.context.view_layer.update()

    inv = np.array(cam.matrix_world.inverted())
    pts = np.concatenate([ws, np.ones((len(ws), 1))], axis=1) @ inv.T
    minx, maxx = pts[:, 0].min(), pts[:, 0].max()
    miny, maxy = pts[:, 1].min(), pts[:, 1].max()
    s_w = (maxx - minx) / max_w_frac
    s_h = (maxy - miny) / ((bottom_y - top_margin) / SIZE)
    s = max(s_w, s_h) * 1.02
    cam_data.ortho_scale = s
    cam_data.shift_x = float((minx + maxx) / 2) / s
    target_bottom = (0.5 - bottom_y / SIZE) * s
    cam_data.shift_y = float(miny - target_bottom) / s
    return cam


def setup_lighting(scene):
    """无投影写实光照：环境 + 柔和主光（阴影全关，符合掩体"无阴影"资产原则）。"""
    world = bpy.data.worlds.new("env")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.42, 0.46, 1.0)  # 环境更亮更平
    bg.inputs[1].default_value = 1.0
    scene.world = world

    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = 0.9  # 主光减弱：更平、无阴影感
    sun_data.use_shadow = False
    sun = bpy.data.objects.new("key", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(38))

    fill_data = bpy.data.lights.new("fill", "AREA")
    fill_data.energy = 60.0  # 补光增强：整体更亮更均匀
    fill_data.size = 6.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-8, -6, 4)


def mirror_png(path, scene):
    stem, ext = os.path.splitext(path)
    vpath = (stem[:-2] + "_v" if stem.endswith("_h") else stem + "_v") + ext
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    px = px[:, ::-1, :]
    out = bpy.data.images.new(os.path.basename(vpath), width=w, height=h)
    out.pixels = px.ravel()
    out.save_render(vpath, scene=scene)
    print("mirrored ->", vpath)


def main():
    spec_path, tex_path, out_path, mirror = parse_args()
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True  # 透明背景：主体自带 alpha，无需颜色阈值抠图
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0

    objs = build_wall(spec["primitives"], tex_path)
    setup_lighting(scene)
    cam = setup_camera(spec, objs)
    scene.camera = cam

    scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath)
    if mirror:
        mirror_png(scene.render.filepath, scene)


if __name__ == "__main__":
    main()
