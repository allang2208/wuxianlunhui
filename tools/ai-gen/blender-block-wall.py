#!/usr/bin/env python3
"""1×1 方块墙（体数=1）Blender 建模 + 8格/边菱形闭合验证（2026-08-17）。

概念：墙不再是一长条，而是一个占 1 格的立方块（类似门柱的矩形柱），
摆放在等距菱形网格上（格子边向量 e1=(64,32) e2=(-64,32)，斜率 0.5）。
块与块贴边拼接、拐角由相邻块在顶点相接，天然无缝；全图只用一张方块贴图。
当前基地菱形（rx 512/ry 256）正好 8 格/边。
"""
import bmesh
import math
import os

import bpy
import mathutils

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))

S = 64.0          # 格半宽（cell 128×64，边向量 (±64, 32)）
H = 80.0          # 方块高（柱状，略像门柱）
EDGE = 8          # 基地菱形 8 格/边


def add_block(cx, cy, mat):
    """在格子中心 (cx,cy) 放一个菱形柱方块（footprint=1格，高 H）。"""
    me = bpy.data.meshes.new(f"block_{cx}_{cy}")
    bm = bmesh.new()
    half = S / 2
    quad = [(half, 0), (0, half / 2), (-half, 0), (0, -half / 2)]
    v = [bm.verts.new((x + cx, y + cy, z)) for (x, y) in quad for z in (0, H)]
    faces = [
        (0, 1, 2, 3),            # 底
        (4, 5, 6, 7),            # 顶
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),  # 四侧
    ]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(obj)
    if len(obj.data.materials) == 0:
        obj.data.materials.append(mat)
    return obj


def ring_cells():
    """基地菱形 8 格/边：T(0,-256) R(512,0) B(0,256) L(-512,0)，返回 32 个格心。"""
    e1 = (S, S / 2)     # T→R 方向
    e2 = (-S, S / 2)    # T→L 方向
    T = (0.0, -EDGE * S / 2)
    R = (EDGE * S, 0.0)
    B = (0.0, EDGE * S / 2)
    L = (-EDGE * S, 0.0)
    cells = []
    for k in range(EDGE):
        cells.append((T[0] + (k + 0.5) * e2[0], T[1] + (k + 0.5) * e2[1]))  # TL
        cells.append((T[0] + (k + 0.5) * e1[0], T[1] + (k + 0.5) * e1[1]))  # TR
        cells.append((R[0] + (k + 0.5) * e2[0], R[1] + (k + 0.5) * e2[1]))  # RB
        cells.append((L[0] + (k + 0.5) * e1[0], L[1] + (k + 0.5) * e1[1]))  # LB
    return cells


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (*color, 1)
    return mat


def render_scene(filepath, elevation=30.0, ortho_scale=0, center=(0, 0)):
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
    el = math.radians(elevation)
    dist = extent * 4
    cam.location = (center[0], center[1] - dist * math.cos(el), dist * math.sin(el))
    cam.rotation_euler = (math.radians(90) - el, 0, 0)
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = [inv @ c for c in corners]
    minx = min(p.x for p in pts); maxx = max(p.x for p in pts)
    miny = min(p.y for p in pts); maxy = max(p.y for p in pts)
    s = ortho_scale or max((maxx - minx) / 0.8, (maxy - miny) / 0.8) * 1.02
    cam_data.ortho_scale = s
    cam_data.shift_x = ((minx + maxx) / 2) / s
    cam_data.shift_y = ((miny + maxy) / 2) / s
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(center[0], center[1], 2500))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = filepath
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print("[block-wall] saved", filepath)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    # 单块渲染（游戏贴图源）
    mat_block = make_material("block", (0.62, 0.48, 0.30))
    add_block(0, 0, mat_block)
    render_scene(os.path.join(OUT_DIR, "block_1x1.png"), elevation=30.0, ortho_scale=420)
    # 8格/边 菱形（32 块）顶视 + 等距
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat2 = make_material("block2", (0.62, 0.48, 0.30))
    cells = ring_cells()
    print(f"[block-wall] 格数 = {len(cells)}（8格/边 × 4）")
    for (cx, cy) in cells:
        add_block(cx, cy, mat2)
    render_scene(os.path.join(OUT_DIR, "block_diamond_top.png"), elevation=90.0, ortho_scale=2100)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat3 = make_material("block3", (0.62, 0.48, 0.30))
    for (cx, cy) in cells:
        add_block(cx, cy, mat3)
    render_scene(os.path.join(OUT_DIR, "block_diamond_iso.png"), elevation=30.0, ortho_scale=2100)


main()
