#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""世界-122 掩体同款铁栅栏滑动门渲染 v2（2026-08-15 / 2026-08-17 加水平横杆）。

门体：左右两根细立柱 + 纤细铁栅栏 + 每扇叶上下两条水平横杆
（rail，穿过该叶所有竖杆）。开合：整扇叶（立柱+栅栏+横杆）沿墙轴向左右滑出
（开门→隐藏），关闭时从两侧向中间靠拢。

用法：
    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python render-cover-gate.py -- spec.json out.png [--slide 0..1]

spec：
  - primitives：立柱（leaf: -1/+1 标记所属扇叶）；
  - bars：栅栏竖杆与水平 rail（leaf/side 标记）；rail 为 box 型水平横杆，穿过竖杆列；
  - leaf_slide：{ distance, leftLeaf, rightLeaf } —— 开门时扇叶整体滑出的世界距离。
相机取景以关闭位（slide=0）为准（先取景后滑出），保证 16 帧同比例。
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
        sys.exit("usage: blender --background --python render-cover-gate.py -- spec.json out.png [--slide 0..1]")
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


def _local_to_world(lx, ly, lz, pos, rot_z_deg):
    r = math.radians(rot_z_deg)
    c, s = math.cos(r), math.sin(r)
    return (pos[0] + lx * c - ly * s, pos[1] + lx * s + ly * c, pos[2] + lz)


def build_scene(spec, tex_path, tex2_path):
    img = bpy.data.images.load(tex_path)
    img2 = bpy.data.images.load(tex2_path) if tex2_path else None
    objs = []
    rot_z = 44.8
    for p in spec.get("primitives", []):
        rot = p.get("rot", [0, 0, 0])
        rot_z = rot[2]
    leaf_tags = {}

    # ---- 立柱（细柱，砖墙材质）----
    for i, p in enumerate(spec["primitives"]):
        bpy.ops.mesh.primitive_cube_add(size=2)
        o = bpy.context.active_object
        w, d, h = p["size"]
        o.scale = (w / 2, d / 2, h / 2)
        o.name = f"frame_{i}"
        rot = p.get("rot", [0, 0, 0])
        pos = p.get("pos", [0, 0, 0])
        o.location = _local_to_world(pos[0], pos[1], pos[2], [0, 0, 0], rot[2])
        o.rotation_euler = [math.radians(a) for a in rot]
        if p.get("bevel", 0) > 0:
            bevel_corners(o, amount=float(p["bevel"]), segments=int(p.get("bevelSegments", 3)),
                          top_only=bool(p.get("bevelTopOnly", False)))
        box_full_uv(o)
        mat = bpy.data.materials.new(f"m_brick_{i}")
        mat.use_nodes = True
        nt = mat.node_tree
        nodes, links = nt.nodes, nt.links
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.85
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        bump.inputs["Distance"].default_value = 0.25
        links.new(tex.outputs["Color"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        o.data.materials.append(mat)
        if "leaf" in p:
            leaf_tags[o.name] = int(p["leaf"])
        objs.append(o)

    # ---- 栅栏竖杆 + 水平横杆（纤细铁栅栏/横杆，铸铁材质）----
    iron_mat = None
    for i, b in enumerate(spec.get("bars", [])):
        if b.get("type") == "cylinder":
            # 圆柱铁杆（用户指定“圆柱体”）：竖立（轴沿 Z），无需旋转，默认柱面 UV 即可
            bpy.ops.mesh.primitive_cylinder_add(radius=float(b["radius"]), depth=float(b["height"]), vertices=16)
            o = bpy.context.active_object
            o.name = f"bar_{i}"
            wx, wy, wz = _local_to_world(b["x"], 0.0, b["z"], [0, 0, 0], rot_z)
            o.location = (wx, wy, wz)
        else:
            bpy.ops.mesh.primitive_cube_add(size=2)
            o = bpy.context.active_object
            w, d, h = b["size"]
            o.scale = (w / 2, d / 2, h / 2)
            o.name = f"bar_{i}"
            wx, wy, wz = _local_to_world(b["x"], 0.0, b["z"], [0, 0, 0], rot_z)
            o.location = (wx, wy, wz)
            o.rotation_euler = (0, 0, math.radians(rot_z))
            if b.get("bevel", 0) > 0:
                bevel_corners(o, amount=float(b["bevel"]), segments=int(b.get("bevelSegments", 3)))
            box_full_uv(o)
        if iron_mat is None:
            iron_mat = bpy.data.materials.new("m_iron")
            iron_mat.use_nodes = True
            nt = iron_mat.node_tree
            nodes, links = nt.nodes, nt.links
            bsdf = nodes.get("Principled BSDF")
            bsdf.inputs["Roughness"].default_value = 0.6
            bsdf.inputs["Metallic"].default_value = 0.75
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img2 if img2 else img
            tex.interpolation = "Linear"
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            bump = nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 0.35
            bump.inputs["Distance"].default_value = 0.3
            links.new(tex.outputs["Color"], bump.inputs["Height"])
            links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        o.data.materials.append(iron_mat)
        if b.get("leaf") is not None or b.get("side") is not None:
            leaf_tags[o.name] = int(b.get("leaf") if b.get("leaf") is not None else b.get("side"))
        objs.append(o)
    return objs, leaf_tags, rot_z


def apply_leaf_slide(objs, leaf_tags, rot_z, slide, spec):
    """开门：扇叶整体沿墙轴向（局部 +x 旋转 rot_z）向两侧滑出；关闭（slide=0）归位。"""
    if slide <= 0:
        return
    cfg = spec.get("leaf_slide", {})
    dist = float(cfg.get("distance", 170))
    c, s = math.cos(math.radians(rot_z)), math.sin(math.radians(rot_z))
    moved = 0
    for o in objs:
        leaf = leaf_tags.get(o.name)
        if leaf is None:
            continue
        dx = leaf * slide * dist
        o.location.x += dx * c
        o.location.y += dx * s
        moved += 1
    if os.environ.get("GATE_DEBUG"):
        print(f"[gate-debug] leaf slide {slide} dist {dist} moved {moved} objects")


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
        if o.name.startswith("bar_"):
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
    if os.environ.get("GATE_DEBUG"):
        print(f"[gate-cam] ortho_scale={s:.3f} shift_x={cam_data.shift_x:.4f} shift_y={cam_data.shift_y:.4f} "
              f"proj bbox x {minx:.2f}..{maxx:.2f} y {miny:.2f}..{maxy:.2f}")
    return cam


def setup_lighting(scene):
    world = bpy.data.worlds.new("env")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.42, 0.46, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world
    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = 0.9
    sun_data.use_shadow = False
    sun = bpy.data.objects.new("key", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(38))
    fill_data = bpy.data.lights.new("fill", "AREA")
    fill_data.energy = 60.0
    fill_data.size = 6.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-8, -6, 4)


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
    objs, leaf_tags, rot_z = build_scene(spec, spec.get("tex"), spec.get("tex2"))
    setup_lighting(scene)
    cam = setup_camera(spec, objs)  # 以关闭位（slide=0）取景
    scene.camera = cam
    apply_leaf_slide(objs, leaf_tags, rot_z, slide, spec)
    if os.environ.get("GATE_DEBUG"):
        inv = np.array(cam.matrix_world.inverted())
        size2 = size
        for label, pt in [
            ("faceA_world", mathutils.Vector((-93.7, -129.8, 0.0))),
            ("faceB_world", mathutils.Vector((130.4, 92.9, 0.0))),
        ]:
            p = np.concatenate([np.array(pt), np.ones(1)]) @ inv.T
            print(f"[gate-proj] {label}: cam=({p[0]:.1f},{p[1]:.1f},{p[2]:.1f}) "
                  f"px=({size2 / 2 + p[0] / cam.data.ortho_scale * size2:.0f}, "
                  f"{size2 / 2 - (p[1] - cam.data.shift_y * cam.data.ortho_scale) / cam.data.ortho_scale * size2:.0f})")
    scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath)


if __name__ == "__main__":
    main()
