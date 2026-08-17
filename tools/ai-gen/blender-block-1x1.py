#!/usr/bin/env python3
"""1×1 方格块最终版渲染（2026-08-17）：无土脚、标准相机（elevation30/bottom_y880），
菱形柱 footprint=1格(64×32)、高 80。输出贴图 + 底边线标定 + 8格/边菱形合成诊断。
"""
import bmesh
import math
import os

import bpy
import mathutils

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))
S = 64.0
H = 80.0
EDGE = 8


def block_mesh(name, cx=0.0, cy=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    quad = [(S / 2, 0), (0, S / 4), (-S / 2, 0), (0, -S / 4)]
    v = [bm.verts.new((x + cx, y + cy, z)) for (x, y) in quad for z in (0, H)]
    faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bm.to_mesh(me)
    bm.free()
    return me


def add_block(cx, cy, mat):
    obj = bpy.data.objects.new("block", block_mesh(f"b_{cx}_{cy}", cx, cy))
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (*color, 1)
    return mat


def render_std(filepath, ortho_scale=0):
    """标准相机：elevation 30 / azimuth 0 / bottom_y 880 取景（与 render-cover-real 一致）。"""
    bpy.context.view_layer.update()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    corners = []
    for o in objs:
        for c in o.bound_box:
            corners.append(o.matrix_world @ mathutils.Vector(c))
    ws = [[c.x, c.y, c.z] for c in corners]
    extent = max(max(a) - min(a) for a in zip(*ws))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, extent * 10)
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    el = math.radians(30)
    dist = extent * 4
    cam.location = (0, -dist * math.cos(el), dist * math.sin(el))
    cam.rotation_euler = (math.radians(60), 0, 0)
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = [inv @ c for c in corners]
    minx = min(p.x for p in pts); maxx = max(p.x for p in pts)
    miny = min(p.y for p in pts); maxy = max(p.y for p in pts)
    s = ortho_scale or max((maxx - minx) / 0.8, (maxy - miny) / ((880 - 64) / 1024)) * 1.02
    cam_data.ortho_scale = s
    cam_data.shift_x = ((minx + maxx) / 2) / s
    target_bottom = (0.5 - 880 / 1024) * s
    cam_data.shift_y = (miny - target_bottom) / s
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 2500))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = filepath
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print("[block1x1] saved", filepath)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat = make_material("block", (0.62, 0.48, 0.30))
    add_block(0, 0, mat)
    render_std(os.path.join(OUT_DIR, "block_1x1_final.png"), ortho_scale=0)
    # 8 格/边 菱形（32 块）
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat2 = make_material("block2", (0.62, 0.48, 0.30))
    e1 = (S, S / 2)
    e2 = (-S, S / 2)
    T = (0.0, -EDGE * S / 2)
    R = (EDGE * S, 0.0)
    B = (0.0, EDGE * S / 2)
    L = (-EDGE * S, 0.0)
    cells = []
    for k in range(EDGE):
        cells += [(T[0] + (k + 0.5) * e2[0], T[1] + (k + 0.5) * e2[1])]  # TL
        cells += [(T[0] + (k + 0.5) * e1[0], T[1] + (k + 0.5) * e1[1])]  # TR
        cells += [(R[0] + (k + 0.5) * e2[0], R[1] + (k + 0.5) * e2[1])]  # RB
        cells += [(L[0] + (k + 0.5) * e1[0], L[1] + (k + 0.5) * e1[1])]  # LB
    for (cx, cy) in cells:
        add_block(cx, cy, mat2)
    print(f"[block1x1] 块数 = {len(cells)}")
    render_std(os.path.join(OUT_DIR, "block_diamond_final_top.png"), ortho_scale=2200)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat3 = make_material("block3", (0.62, 0.48, 0.30))
    for (cx, cy) in cells:
        add_block(cx, cy, mat3)
    render_std(os.path.join(OUT_DIR, "block_diamond_final_iso.png"), ortho_scale=2200)


main()
