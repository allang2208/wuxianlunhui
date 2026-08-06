#!/usr/bin/env python3
"""路线 B（建筑版）：Blender 几何 + AI 材质 → 写实建筑贴图（正面平视 billboard、平底、无阴影）。

2026-08-06：祭坛/仓库重做。与 render-cover-real.py 同管线，区别：
  - 视角：正面平视（相机俯仰默认 5°，最多一条极窄顶边），不是墙段的 30° 等距；
  - 几何：多 box + prism（三角棱柱，坡屋顶）组合，每部件可独立材质纹理；
  - 输出：1024×1024 透明底、底边平、无投影（建筑/道具视觉语言，与人物/塔一致）。

用法：
    blender --background --factory-startup \
        --python render-building-real.py -- spec.json out.png

Spec JSON：
  {"elevation": 5, "bottom_y": 870, "max_width_frac": 0.8,
   "primitives": [
     {"type":"box","size":[260,180,40],"pos":[0,0,20],"bevel":4,"tex":"tex_altar.png"},
     {"type":"prism","size":[300,220,90],"pos":[0,0,150],"tex":"tex_roof.png"}
   ]}
  tex 字段相对 spec 所在目录；缺省用主纹理。
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
    if len(argv) != 2:
        sys.exit("usage: blender --background --python render-building-real.py -- spec.json out.png")
    return argv[0], argv[1]


def bevel_corners(o, amount=4.0, segments=2):
    """8 个顶角圆滑（轻量，建筑用 2~5 世界 px）。"""
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
    """每个面独立展开到整张纹理 [0,1]²（盒形展开，V 轴朝上）。"""
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


def make_prism(L, W, H):
    """三角棱柱（等腰三角形截面，沿 X 延伸），底边平：适合坡屋顶。"""
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
        bm.verts.new((-L/2, -W/2, 0)), bm.verts.new((-L/2, W/2, 0)),
        bm.verts.new((-L/2, 0, H)), bm.verts.new((L/2, -W/2, 0)),
        bm.verts.new((L/2, W/2, 0)), bm.verts.new((L/2, 0, H)),
    ]
    bm.faces.new([verts[0], verts[2], verts[1]])          # 前三角（-Y 面）
    bm.faces.new([verts[3], verts[4], verts[5]])          # 后三角（+Y 面）
    bm.faces.new([verts[0], verts[1], verts[4], verts[3]])  # 底面
    bm.faces.new([verts[1], verts[2], verts[5], verts[4]])  # 右坡面
    bm.faces.new([verts[0], verts[3], verts[5], verts[2]])  # 左坡面
    bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def build_building(spec, default_tex, base_dir):
    """建建筑体（box/prism 组合），每部件可选独立材质纹理。"""
    img_cache = {}
    def get_img(tex):
        if tex not in img_cache:
            p = os.path.join(base_dir, tex) if not os.path.isabs(tex) else tex
            img_cache[tex] = bpy.data.images.load(p)
        return img_cache[tex]
    objs = []
    for i, p in enumerate(spec.get("primitives", [])):
        t = p["type"]
        if t == "box":
            bpy.ops.mesh.primitive_cube_add(size=2)
            o = bpy.context.active_object
            w, d, h = p["size"]
            o.scale = (w / 2, d / 2, h / 2)
        elif t == "prism":
            L, W, H = p["size"]
            o = make_prism(L, W, H)
        else:
            sys.exit(f"unsupported primitive: {t}")
        o.name = f"bld_{i}"
        o.location = p.get("pos", [0, 0, 0])
        rot = p.get("rot", [0, 0, 0])
        o.rotation_euler = [math.radians(a) for a in rot]
        if p.get("bevel", 0) > 0:
            bevel_corners(o, amount=float(p["bevel"]), segments=int(p.get("bevelSegments", 2)))
        box_full_uv(o)
        img = get_img(p.get("tex", default_tex))
        mat = bpy.data.materials.new(f"m_{i}")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.85
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        bump.inputs["Distance"].default_value = 0.25
        nt.links.new(tex.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        o.data.materials.append(mat)
        objs.append(o)
    return objs


def setup_camera(spec, objs):
    """正交相机：正面平视（elevation 默认 5°），底边落 bottom_y。"""
    elevation = math.radians(spec.get("elevation", 5))
    azimuth = math.radians(spec.get("azimuth", 0))
    bottom_y = spec.get("bottom_y", 870)
    max_w_frac = spec.get("max_width_frac", 0.8)
    top_margin = spec.get("top_margin_px", 80)
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
    """无投影写实光照：环境 + 柔和主光 + 补光（无阴影，符合资产原则）。"""
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
    spec_path, out_path = parse_args()
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0
    base_dir = os.path.dirname(os.path.abspath(spec_path))
    default_tex = spec.get("default_tex")
    objs = build_building(spec, default_tex, base_dir)
    setup_lighting(scene)
    cam = setup_camera(spec, objs)
    scene.camera = cam
    scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath)


if __name__ == "__main__":
    main()
