#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""世界-122 工厂模型渲染（Blender 几何 + 仓库/铸铁材质，2026-08-15）。

工厂 = 矩形立方体厂房 + 门口两根矩形立柱 + 两块横向开合的铁板门。
视角与世界-122 掩体/滑动门同一套：正面、俯仰 30°（rot.z=44.8 接地斜率，
与 D 级掩体/基地铁栅栏滑动门同口径），透明底、无投影。

用法：
    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python render-factory-real.py -- spec.json out.png [--slide 0..1]

--slide 0 = 关门（两块铁板并拢封住门洞）；1 = 开门（铁板向两侧立柱收拢）。

Spec（_blockout_specs/factory.json）：
  - primitives：静态几何 box（material: wall=主墙贴图 / dark=门洞暗部），
    pos 为局部坐标（沿墙 local x / 垂直 y / z 向上），rot.z 统一 44.8；
  - plates：两块铁板（size=[宽,厚,高], x=关门位置, y=距墙面前突, z=中心高,
    side=-1 左 / 1 右），slide 时向对应侧 window 中心滑入；
  - slide：leftWindow/rightWindow = 两侧立柱收拢窗口。
"""
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    spec_path = None
    out_path = None
    slide = 0.0
    i = 0
    while i < len(argv):
        if argv[i] == "--slide" and i + 1 < len(argv):
            slide = float(argv[i + 1])
            i += 2
        elif spec_path is None:
            spec_path = argv[i]
            i += 1
        elif out_path is None:
            out_path = argv[i]
            i += 1
        else:
            i += 1
    if not spec_path or not out_path:
        sys.exit("usage: blender --background --python render-factory-real.py -- spec.json out.png [--slide 0..1]")
    return spec_path, out_path, slide


def bevel_corners(o, amount=6.0, segments=3, top_only=False):
    import bmesh
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(o.data)
    geom = [v for v in bm.verts if not top_only or v.co.z > -0.001]
    bmesh.ops.bevel(
        bm,
        geom=geom,
        offset=amount,
        offset_type="OFFSET",
        segments=segments,
        profile=0.5,
        affect="VERTICES",
    )
    bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")


def box_full_uv(o):
    """每面独立展开到整张纹理 [0,1]^2（V 轴优先世界 Z 朝上），修默认 cube 3x2 UV 坑。"""
    me = o.data
    uvl = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        main = max(range(3), key=lambda i: abs(n[i]))
        others = [i for i in range(3) if i != main]
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


def _local_to_world(lx, ly, lz, rot_z_deg):
    r = math.radians(rot_z_deg)
    c, s = math.cos(r), math.sin(r)
    return (lx * c - ly * s, lx * s + ly * c, lz)


def make_prism(L, W, H):
    """三角棱柱（等腰三角形截面，沿 X 延伸），底边平：坡屋顶用。"""
    bpy.ops.mesh.primitive_cube_add(size=2)
    o = bpy.context.active_object
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    import bmesh
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(o.data)
    verts = [
        bm.verts.new((-L / 2, -W / 2, 0)), bm.verts.new((-L / 2, W / 2, 0)),
        bm.verts.new((-L / 2, 0, H)), bm.verts.new((L / 2, -W / 2, 0)),
        bm.verts.new((L / 2, W / 2, 0)), bm.verts.new((L / 2, 0, H)),
    ]
    bm.faces.new([verts[0], verts[2], verts[1]])
    bm.faces.new([verts[3], verts[4], verts[5]])
    bm.faces.new([verts[0], verts[1], verts[4], verts[3]])
    bm.faces.new([verts[1], verts[2], verts[5], verts[4]])
    bm.faces.new([verts[0], verts[3], verts[5], verts[2]])
    bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def make_textured_mat(name, img, roughness=0.85, metallic=0.0, bump_strength=0.25):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest" if img.size[0] < 512 else "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.25
    links.new(tex.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def make_dark_mat(name="m_dark"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.055, 0.06, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    return mat


def make_interior_mat(name="m_interior", glow_path=None):
    """室内开灯材质：白(上)→暖黄(下)渐变 + 自发光（黄→白灯光效果）。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.4
    tex = nodes.new("ShaderNodeTexImage")
    if glow_path and os.path.exists(glow_path):
        tex.image = bpy.data.images.load(glow_path)
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    return mat


def make_window_mat(name="m_window"):
    """窗户灯光材质：暖黄自发光（模拟室内开灯）。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.72, 0.18, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.5
    return mat


def build_scene(spec, slide):
    img = bpy.data.images.load(spec["tex"])
    img2 = bpy.data.images.load(spec["tex2"]) if spec.get("tex2") else None
    img_roof = bpy.data.images.load(spec["roof_tex"]) if spec.get("roof_tex") else None
    wall_mat = make_textured_mat("m_wall", img, roughness=0.85, metallic=0.0)
    roof_mat = make_textured_mat("m_roof", img_roof if img_roof else img,
                                 roughness=0.9, metallic=0.0, bump_strength=0.2)
    iron_mat = make_textured_mat("m_iron", img2 if img2 else img,
                                 roughness=0.6, metallic=0.75, bump_strength=0.35)
    dark_mat = make_dark_mat()
    interior_mat = make_interior_mat("m_interior", spec.get("interior_glow"))
    window_mat = make_window_mat()
    debug_color = os.environ.get("FACTORY_DEBUG_COLOR")
    if debug_color:
        def dbg_mat(name, rgba):
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            bsdf = m.node_tree.nodes.get("Principled BSDF")
            bsdf.inputs["Base Color"].default_value = rgba
            bsdf.inputs["Roughness"].default_value = 0.6
            return m
        wall_mat = dbg_mat("dbg_wall", (0.75, 0.45, 0.2, 1.0))
        roof_mat = dbg_mat("dbg_roof", (0.45, 0.3, 0.2, 1.0))
        iron_mat = dbg_mat("dbg_iron", (0.9, 0.1, 0.1, 1.0))
        dark_mat = dbg_mat("dbg_dark", (0.05, 0.05, 0.9, 1.0))
        interior_mat = dbg_mat("dbg_interior", (0.1, 0.9, 0.1, 1.0))
        window_mat = dbg_mat("dbg_window", (1.0, 0.0, 1.0, 1.0))
    objs = []

    rot_z = 44.8
    for p in spec.get("primitives", []):
        rot = p.get("rot", [0, 0, 0])
        rot_z = rot[2]
    for i, p in enumerate(spec["primitives"]):
        t = p.get("type", "box")
        if t == "prism":
            w, d, h = p["size"]
            o = make_prism(w, d, h)
        else:
            bpy.ops.mesh.primitive_cube_add(size=2)
            o = bpy.context.active_object
            w, d, h = p["size"]
            o.scale = (w / 2, d / 2, h / 2)
        o.name = f"factory_{i}"
        pos = p.get("pos", [0, 0, 0])
        rot = p.get("rot", [0, 0, 0])
        o.location = _local_to_world(pos[0], pos[1], pos[2], rot[2])
        o.rotation_euler = [math.radians(a) for a in rot]
        if p.get("bevel", 0) > 0:
            bevel_corners(o, amount=float(p["bevel"]),
                          segments=int(p.get("bevelSegments", 3)),
                          top_only=bool(p.get("bevelTopOnly", False)))
        box_full_uv(o)
        if p.get("material") == "roof":
            o.data.materials.append(roof_mat)
        elif p.get("material") == "window":
            o.data.materials.append(window_mat)
        elif p.get("material") == "interior":
            o.data.materials.append(interior_mat)
        elif p.get("material") == "dark":
            o.data.materials.append(dark_mat)
        else:
            o.data.materials.append(wall_mat)
        if os.environ.get("FACTORY_DEBUG"):
            print(f"[factory-debug] prim {i} world=({o.location.x:.1f},{o.location.y:.1f},{o.location.z:.1f}) "
                  f"size={p['size']} mat={p.get('material','wall')}", flush=True)
        objs.append(o)

    # 两块横向开合铁板（slide 0 = 并拢关，1 = 滑入两侧立柱窗口）
    slide_cfg = spec.get("slide", {})
    lw = slide_cfg.get("leftWindow", {"center": -108, "half": 23})
    rw = slide_cfg.get("rightWindow", {"center": 108, "half": 23})
    for i, b in enumerate(spec.get("plates", [])):
        bpy.ops.mesh.primitive_cube_add(size=2)
        o = bpy.context.active_object
        w, d, h = b["size"]
        o.scale = (w / 2, d / 2, h / 2)
        o.name = f"plate_{i}"
        win = lw if b.get("side", -1) < 0 else rw
        dx = b["x"] + (win["center"] - b["x"]) * slide
        wx, wy, wz = _local_to_world(dx, b.get("y", 0.0), b["z"], rot_z)
        o.location = (wx, wy, wz)
        o.rotation_euler = (0, 0, math.radians(rot_z))
        if b.get("bevel", 0) > 0:
            bevel_corners(o, amount=float(b["bevel"]), segments=int(b.get("bevelSegments", 2)))
        box_full_uv(o)
        o.data.materials.append(iron_mat)
        if os.environ.get("FACTORY_DEBUG"):
            print(f"[factory-debug] plate {i} slide={slide:.2f} side={b.get('side')} "
                  f"world=({o.location.x:.1f},{o.location.y:.1f},{o.location.z:.1f})", flush=True)
        objs.append(o)
    return objs


def setup_camera(spec, objs):
    elevation = math.radians(spec.get("elevation", 30))
    azimuth = math.radians(spec.get("azimuth", 0))
    size = int(spec.get("resolution", 1024))
    bottom_y = spec.get("bottom_y", 880) * size / 1024.0
    max_w_frac = spec.get("max_width_frac", 0.8)
    top_margin = spec.get("top_margin_px", 64) * size / 1024.0
    soil_margin = spec.get("soil_margin", 0.18)
    bpy.context.view_layer.update()
    corners = []
    for o in objs:
        if o.name.startswith("plate_"):
            continue
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
    s_h = (maxy - miny) / ((bottom_y - top_margin) / size)
    s = float(spec.get("ortho_scale") or 0) or max(s_w, s_h) * (1.02 + soil_margin)
    cam_data.ortho_scale = s
    cam_data.shift_x = float((minx + maxx) / 2) / s
    target_bottom = (0.5 - bottom_y / size) * s
    cam_data.shift_y = float(miny - target_bottom) / s
    return cam


def setup_lighting(scene, spec):
    """无投影写实光照；spec.lighting 可覆盖 环境/主光/补光/曝光（默认与原一致）。"""
    L = spec.get("lighting") or {}
    ambient = float(L.get("ambient", 0.42))
    world = bpy.data.worlds.new("env")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (ambient, ambient, ambient + 0.04, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world
    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = float(L.get("sun", 0.9))
    sun_data.use_shadow = False
    sun = bpy.data.objects.new("key", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(38))
    fill_data = bpy.data.lights.new("fill", "AREA")
    fill_data.energy = float(L.get("fill", 60.0))
    fill_data.size = 6.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-8, -6, 4)
    scene.view_settings.exposure = float(L.get("exposure", 0))


def main():
    spec_path, out_path, slide = parse_args()
    with open(spec_path, "r", encoding="utf-8-sig") as f:
        spec = json.load(f)
    size = int(spec.get("resolution", 1024))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0
    # 工厂含高亮黄色自发光（窗户/门洞灯光），AgX 会把它压成米白——
    # 改用 Standard 视图变换保留灯光黄色。
    scene.view_settings.view_transform = "Standard"
    objs = build_scene(spec, slide)
    setup_lighting(scene, spec)
    cam = setup_camera(spec, objs)
    scene.camera = cam
    scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath, "slide =", slide)


if __name__ == "__main__":
    main()
